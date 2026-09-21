import { cifrarSegredo, guardaDeSegredosConfigurada } from "@/lib/server/segredos";
import { ApiError, apiRoute, auditStatement, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { DrapPartnerError, emitirChaveNaDrap, isDrapPartnerConfigured } from "@/lib/integrations/drap-partner";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

/**
 * Pede outra chave para uma empresa que já está conectada.
 *
 * ─── POR QUE ISTO EXISTE ───
 *
 * A chave nasce com um conjunto fixo de acessos, decidido no momento em que é emitida.
 * Quando a plataforma passa a usar um recurso novo — emitir nota, por exemplo — as
 * empresas conectadas antes continuam com a chave antiga, que não alcança esse recurso.
 *
 * Reconectar não resolve: a empresa já existe do outro lado, o pedido repetido devolve a
 * mesma empresa e a chave NÃO vem de novo (ela aparece uma vez só, na criação). Sem este
 * caminho, a única saída seria apagar a empresa e recriá-la — perdendo o histórico
 * financeiro dela para corrigir uma credencial.
 *
 * A chave anterior continua válida do outro lado. Aqui ela é substituída: o que a
 * plataforma usa passa a ser a nova, e a antiga deixa de estar ao alcance de quem opera
 * por aqui.
 */
export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    // Trocar credencial de empresa é decisão de quem responde pela empresa.
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");

    if (!isDrapPartnerConfigured()) {
      throw new ApiError(503, "drap_partner_not_configured", "A conexão automática com a Drap não está configurada nesta instalação.");
    }
    // Checado ANTES de pedir: emitir uma chave que não há onde guardar deixaria uma
    // credencial viva do outro lado sem ninguém aqui capaz de usá-la.
    if (!guardaDeSegredosConfigurada()) {
      throw new ApiError(503, "secrets_unavailable", "A guarda de credenciais não está configurada nesta instalação.");
    }

    const conexao = await context.db.prepare(
      "SELECT id, external_company_id, origem FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1",
    ).bind(context.organization.id).first<{ id: string; external_company_id: string; origem: string | null }>();
    if (!conexao) throw new ApiError(409, "sem_conexao", "Esta empresa ainda não está conectada à Drap.");

    let chave: string;
    try {
      chave = await emitirChaveNaDrap(conexao.external_company_id);
    } catch (causa) {
      if (causa instanceof DrapPartnerError) {
        // O motivo vem da Drap e costuma ser acionável — empresa removida de lá,
        // parceiro sem permissão sobre ela.
        throw new ApiError(causa.status === 403 || causa.status === 404 ? causa.status : 502, causa.codigo, causa.detalhe);
      }
      throw new ApiError(502, "drap_unavailable", "Não foi possível pedir a credencial à Drap agora.");
    }

    await context.db.batch([
      context.db.prepare(
        "UPDATE integration_connections SET api_token_encrypted = ?1, status = 'active', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND organization_id = ?3",
      ).bind(await cifrarSegredo(chave), conexao.id, context.organization.id),
      // O id da empresa entra na auditoria; a chave, nunca.
      auditStatement(context, "integration.drap_chave_renovada", "integration_connection", conexao.id, {
        externalCompanyId: conexao.external_company_id,
      }),
    ]);

    return Response.json({ renovada: true }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
