import { ApiError, apiRoute, auditStatement, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { tokenGuardado } from "@/lib/server/drap-credenciais";
import { removerWebhookNaDrap } from "@/lib/server/drap-webhook-registro";

export const dynamic = "force-dynamic";

// Desfaz a conexão desta empresa com a Drap.
//
// O que some aqui é o vínculo, não a empresa: os lançamentos, cobranças e a assinatura
// dela continuam na Drap, intactos. O que a plataforma descarta é a credencial com que
// operava — e é por isso que reconectar exige emitir uma chave nova, não "lembrar" a
// antiga.
//
// A assinatura de webhook é removida ANTES de a credencial sumir. Na ordem inversa não
// haveria com o que removê-la, e a Drap seguiria postando o financeiro desta empresa para
// um endereço que ninguém mais opera — um cano de dados aberto depois de o usuário
// mandar fechar.

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");

    const conexao = await context.db.prepare(
      "SELECT id, external_company_id FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1",
    ).bind(context.organization.id).first<{ id: string; external_company_id: string }>();

    if (!conexao) throw new ApiError(409, "sem_conexao", "Esta empresa não está conectada à Drap.");

    // Best-effort de propósito: se a Drap estiver fora do ar, travar aqui deixaria o
    // usuário preso a uma conexão que ele mandou desfazer. A falha é dita na resposta,
    // com o que fazer — remover a assinatura na Drap, à mão.
    let webhook: { removido: boolean; motivo?: string } = { removido: false, motivo: "Nenhuma assinatura registrada por aqui." };
    const token = await tokenGuardado(conexao.external_company_id);
    if (token) webhook = await removerWebhookNaDrap(token);

    await context.db.batch([
      // A linha inteira sai, e não só as credenciais: uma conexão sem token é o mesmo
      // estado de "nunca conectou", e manter a casca faria a tela mostrar uma empresa
      // vinculada que não opera.
      context.db.prepare("DELETE FROM integration_connections WHERE id = ?1 AND organization_id = ?2")
        .bind(conexao.id, context.organization.id),
      auditStatement(context, "integration.drap_desconectada", "integration_connection", conexao.id, {
        externalCompanyId: conexao.external_company_id,
        webhookRemovido: webhook.removido,
      }),
    ]);

    return Response.json(
      { desconectada: true, webhook },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
