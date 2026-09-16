import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { activationFor } from "@/lib/server/activation";
import { isDrapChargesConfigured, isDrapConfigured, isDrapTransactionsConfigured, requestDrapApi } from "@/lib/integrations/drap";

export const dynamic = "force-dynamic";

const connectionSchema = z.object({ externalCompanyId: z.string().trim().min(1).max(160) });

type ConnectionRow = { id: string; external_company_id: string; status: string; last_synced_at: string | null; last_error: string | null };

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
    const connection = await context.db.prepare("SELECT id, external_company_id, status, last_synced_at, last_error FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1")
      .bind(context.organization.id).first<ConnectionRow>();
    return Response.json({
      connection: connection ? {
        id: connection.id,
        externalCompanyId: connection.external_company_id,
        status: connection.status,
        lastSyncedAt: connection.last_synced_at,
        lastError: connection.last_error,
      } : null,
      capabilities: {
        summary: isDrapConfigured(),
        transactions: isDrapTransactionsConfigured(),
        charges: isDrapChargesConfigured(),
      },
    });
  });
}

export async function PUT(request: Request) {
  return apiRoute(async () => {
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
      "SELECT id, external_company_id, status, last_synced_at, last_error FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1",
    ).bind(context.organization.id).first<ConnectionRow>();
    const id = existing?.id ?? crypto.randomUUID();
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
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
