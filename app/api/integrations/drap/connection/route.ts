import { z } from "zod";

import { ApiError, apiRoute, auditStatement, isPlatformSuperAdmin, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { activationFor } from "@/lib/server/activation";
import { fetchDrapActiveModules, isDrapConfigured, isDrapTransactionsConfigured, requestDrapApi } from "@/lib/integrations/drap";
import { probeDrapResource } from "@/lib/server/drap-resources";

export const dynamic = "force-dynamic";

const connectionSchema = z.object({ externalCompanyId: z.string().trim().min(1).max(160) }).strict();

type ConnectionRow = {
  id: string; external_company_id: string; status: string;
  last_synced_at: string | null; last_error: string | null;
  webhook_secret_encrypted: string | null;
};

async function verifyDrapConnection(externalCompanyId: string) {
  try {
    await requestDrapApi(externalCompanyId, "/api/v1/lancamentos?limit=1&offset=0");
    return { status: "active", lastError: null } as const;
  } catch {
    return {
      status: "pending",
      lastError: "Vínculo salvo. Aguardando validação da credencial técnica DRAP para liberar o uso dentro da H.OIKOS.",
    } as const;
  }
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const connection = await context.db.prepare("SELECT id, external_company_id, status, last_synced_at, last_error, webhook_secret_encrypted FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1")
      .bind(context.organization.id).first<ConnectionRow>();
    const chargesProbe = connection?.status === "active"
      ? await probeDrapResource(connection.external_company_id, "cobrancas")
      : null;

    /**
     * Emissão de nota entra como CAPACIDADE, junto das outras, e não como uma seção de
     * plano com marca e preço de outro produto.
     *
     * Para quem usa a H.OIKOS o motor financeiro é invisível: o plano e o valor são
     * daqui. O que a tela precisa saber é binário — dá para emitir, ou não dá — e sem
     * isso a pessoa só descobriria tentando e levando erro, na frente do cliente dela.
     *
     * Falha na consulta vira `false`, nunca exceção: o Financeiro inteiro não pode cair
     * porque o motor não respondeu sobre um recurso que talvez nem seja usado hoje.
     *
     * `credencialDesatualizada` sai separado do plano de propósito. Os dois chegam na
     * tela como "não dá para emitir", e a causa é oposta: um é o plano da empresa, o
     * outro é a chave guardada aqui, emitida antes de a plataforma passar a pedir esse
     * acesso. Confundir os dois manda a pessoa pedir ao suporte um módulo que ela já tem.
     */
    const modulos = connection?.status === "active"
      ? await fetchDrapActiveModules(connection.external_company_id).catch(() => ({ ativos: [] as string[] }))
      : { ativos: [] as string[] };
    return Response.json({
      connection: connection ? {
        id: connection.id,
        externalCompanyId: connection.external_company_id,
        status: connection.status,
        lastSyncedAt: connection.last_synced_at,
        lastError: connection.last_error,
        // Só o fato, nunca o segredo: a tela precisa saber se a empresa avisa quando
        // muda, para oferecer a nova tentativa quando não avisa.
        webhookRegistrado: Boolean(connection.webhook_secret_encrypted),
        // Não é o plano: é a credencial desta instalação, que não alcança a consulta.
        // Quem administra a empresa pode renovar sem desfazer a conexão.
        credencialDesatualizada: "credencialDesatualizada" in modulos && modulos.credencialDesatualizada === true,
      } : null,
      capabilities: {
        summary: isDrapConfigured(),
        transactions: isDrapTransactionsConfigured(),
        charges: chargesProbe?.status === "available",
        notas: modulos.ativos.includes("emissao-nf"),
      },
    });
  });
}

export async function PUT(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");
    const parsed = connectionSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);

    const externalCompanyId = parsed.data.externalCompanyId;
    const activation = await activationFor(context.organization.id);
    if (activation && activation.company_id !== externalCompanyId) {
      throw new ApiError(409, "activation_company_locked", "Esta empresa está vinculada à assinatura do Drap Empresa. Solicite a alteração ao administrador.");
    }

    const existing = await context.db.prepare(
      "SELECT id, external_company_id, status, last_synced_at, last_error, webhook_secret_encrypted FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1",
    ).bind(context.organization.id).first<ConnectionRow>();
    const id = existing?.id ?? crypto.randomUUID();
    // Conhecer um ID Drap não prova posse da empresa nem autoriza usar uma chave do ambiente.
    // O contratante deve provisionar ou apresentar o código de vínculo emitido pela Drap.
    if (!isPlatformSuperAdmin(context) && existing?.external_company_id !== externalCompanyId) {
      throw new ApiError(403, "drap_link_proof_required", "Crie a conta ou utilize o código de vinculação Drap. Um identificador não comprova autorização.");
    }
    if (existing && existing.external_company_id !== externalCompanyId) {
      throw new ApiError(409, "drap_reconnect_required", "Desconecte a empresa anterior antes de estabelecer outro vínculo.");
    }
    const sameActiveConnection = existing?.external_company_id === externalCompanyId && existing.status === "active";
    const verification = sameActiveConnection
      ? { status: "active" as const, lastError: null }
      : await verifyDrapConnection(externalCompanyId);

    await context.db.batch([
      context.db.prepare(`INSERT INTO integration_connections (
        id, organization_id, provider, external_company_id, status, last_synced_at, last_error, created_at, updated_at
      ) VALUES (?1, ?2, 'drap', ?3, ?4, CASE WHEN ?4 = 'active' THEN CURRENT_TIMESTAMP ELSE NULL END, ?5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id, provider) DO UPDATE SET
        external_company_id = excluded.external_company_id,
        status = excluded.status,
        last_synced_at = excluded.last_synced_at,
        last_error = excluded.last_error,
        updated_at = CURRENT_TIMESTAMP`)
        .bind(id, context.organization.id, externalCompanyId, verification.status, verification.lastError),
      auditStatement(context, existing ? "integration.drap_updated" : "integration.drap_connected", "integration_connection", id, {
        externalCompanyId,
        status: verification.status,
      }),
    ]);

    return Response.json({
      connection: {
        id,
        externalCompanyId,
        status: verification.status,
        lastSyncedAt: verification.status === "active" ? new Date().toISOString() : null,
        lastError: verification.lastError,
        // Este caminho é o manual, por variável de ambiente: ali o segredo do webhook
        // também é colado à mão, e não há registro automático a reportar.
        webhookRegistrado: Boolean(existing?.webhook_secret_encrypted),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
