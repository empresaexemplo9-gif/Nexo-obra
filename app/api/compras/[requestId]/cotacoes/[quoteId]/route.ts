import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { carregarPedido, detalharPedido, eventoStatement } from "@/lib/server/compras";
import { cotacoesEditaveis } from "@/lib/compras";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string; quoteId: string }> };

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const { requestId, quoteId } = await route.params;
    if (!z.string().uuid().safeParse(requestId).success || !z.string().uuid().safeParse(quoteId).success) throw new ApiError(404, "not_found", "Cotação não encontrada.");
    const pedido = await carregarPedido(context, requestId);
    if (!cotacoesEditaveis(pedido.status)) throw new ApiError(409, "quotes_locked", "Depois que o pedido sai, as cotações ficam como registro e não mudam.");
    if (pedido.selected_quote_id === quoteId) throw new ApiError(409, "quote_selected", "Esta é a cotação escolhida. Reabra a escolha antes de excluí-la.");
    const cotacao = ensureFound(await context.db.prepare(
      "SELECT q.id, s.name FROM purchase_quotes q JOIN suppliers s ON s.id = q.supplier_id AND s.organization_id = q.organization_id WHERE q.id = ?1 AND q.request_id = ?2 AND q.organization_id = ?3",
    ).bind(quoteId, requestId, context.organization.id).first<{ id: string; name: string }>(), "Cotação");
    await context.db.batch([
      context.db.prepare("DELETE FROM purchase_quote_items WHERE quote_id = ?1 AND organization_id = ?2").bind(quoteId, context.organization.id),
      context.db.prepare("DELETE FROM purchase_quotes WHERE id = ?1 AND organization_id = ?2").bind(quoteId, context.organization.id),
      context.db.prepare("UPDATE purchase_requests SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND organization_id = ?2").bind(requestId, context.organization.id),
      eventoStatement(context, requestId, "cotacao", `Cotação de ${cotacao.name} excluída`),
      auditStatement(context, "purchase_quote.deleted", "purchase_quote", quoteId, { requestId }),
    ]);
    return Response.json(await detalharPedido(context, requestId));
  });
}
