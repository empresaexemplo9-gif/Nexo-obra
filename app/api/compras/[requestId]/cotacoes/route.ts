import { z } from "zod";

import {
  ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { cotacaoEntrada } from "@/lib/server/compras-entrada";
import { carregarPedido, detalharPedido, eventoStatement, itensDoPedido } from "@/lib/server/compras";
import { cotacoesEditaveis } from "@/lib/compras";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

const dinheiro = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Lançar ou corrigir a cotação de um fornecedor. Um fornecedor tem uma cotação por pedido:
// reenviar substitui a anterior em vez de duplicar, e repetir o mesmo envio não muda nada.
export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const { requestId } = await route.params;
    if (!z.string().uuid().safeParse(requestId).success) throw new ApiError(404, "not_found", "Pedido de compra não encontrado.");
    const parsed = cotacaoEntrada.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const pedido = await carregarPedido(context, requestId);
    if (!cotacoesEditaveis(pedido.status)) throw new ApiError(409, "quotes_locked", "Depois que o pedido sai, as cotações ficam como registro e não mudam.");

    const fornecedor = await context.db.prepare("SELECT id, name, active FROM suppliers WHERE id = ?1 AND organization_id = ?2")
      .bind(data.supplierId, context.organization.id).first<{ id: string; name: string; active: number }>();
    if (!fornecedor) throw new ApiError(400, "supplier_not_found", "Fornecedor não encontrado nesta empresa.");
    if (!fornecedor.active) throw new ApiError(400, "supplier_inactive", "Este fornecedor está desativado. Reative o cadastro para cotar.");

    const itens = await itensDoPedido(context, [requestId]);
    if (!itens.length) throw new ApiError(400, "request_without_items", "Inclua os itens do pedido antes de lançar cotações.");
    const doPedido = new Set(itens.map((item) => item.id));
    if (data.prices.some((preco) => !doPedido.has(preco.itemId))) throw new ApiError(400, "item_not_found", "Um dos preços aponta para item de outro pedido.");
    if (new Set(data.prices.map((p) => p.itemId)).size !== data.prices.length) throw validationError({ prices: ["Cada item recebe um preço só."] });
    if (!data.prices.length) throw validationError({ prices: ["Informe o preço de pelo menos um item."] });

    const existente = await context.db.prepare("SELECT id FROM purchase_quotes WHERE request_id = ?1 AND supplier_id = ?2 AND organization_id = ?3")
      .bind(requestId, data.supplierId, context.organization.id).first<{ id: string }>();
    const quoteId = existente?.id ?? crypto.randomUUID();
    const instrucoes = [
      existente
        ? context.db.prepare(
          `UPDATE purchase_quotes SET delivery_days = ?1, payment_terms = ?2, payment_days = ?3, freight_cents = ?4, discount_cents = ?5,
             valid_until = ?6, negotiation_score = ?7, notes = ?8, updated_at = CURRENT_TIMESTAMP WHERE id = ?9 AND organization_id = ?10`,
        ).bind(data.deliveryDays, data.paymentTerms, data.paymentDays, data.freightCents, data.discountCents, data.validUntil, data.negotiationScore, data.notes, quoteId, context.organization.id)
        : context.db.prepare(
          `INSERT INTO purchase_quotes (id, organization_id, request_id, supplier_id, delivery_days, payment_terms, payment_days, freight_cents, discount_cents, valid_until, negotiation_score, notes, created_by_name, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ).bind(quoteId, context.organization.id, requestId, data.supplierId, data.deliveryDays, data.paymentTerms, data.paymentDays, data.freightCents, data.discountCents, data.validUntil, data.negotiationScore, data.notes, context.user.displayName),
      context.db.prepare("DELETE FROM purchase_quote_items WHERE quote_id = ?1 AND organization_id = ?2").bind(quoteId, context.organization.id),
      ...data.prices.map((preco) => context.db.prepare("INSERT INTO purchase_quote_items (id, organization_id, quote_id, request_item_id, unit_price_cents) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(crypto.randomUUID(), context.organization.id, quoteId, preco.itemId, preco.unitPriceCents)),
      // Cotação nova ou corrigida muda a comparação: a revisão do pedido avança para que
      // uma escolha feita sobre a tela antiga seja recusada.
      context.db.prepare("UPDATE purchase_requests SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND organization_id = ?2").bind(requestId, context.organization.id),
      eventoStatement(context, requestId, "cotacao", `${existente ? "Cotação corrigida" : "Cotação lançada"}: ${fornecedor.name} · ${data.prices.length} de ${itens.length} itens · entrega em ${data.deliveryDays} dias${data.freightCents ? ` · frete ${dinheiro(data.freightCents)}` : ""}`),
      auditStatement(context, existente ? "purchase_quote.updated" : "purchase_quote.created", "purchase_quote", quoteId, { requestId, supplierId: data.supplierId }),
    ];
    // Corrigir a cotação escolhida devolve o pedido à escolha: o valor mudou.
    if (pedido.selected_quote_id === quoteId && pedido.status === "a_comprar") {
      instrucoes.push(context.db.prepare("UPDATE purchase_requests SET status = 'a_orcar', selected_quote_id = NULL WHERE id = ?1 AND organization_id = ?2").bind(requestId, context.organization.id));
      instrucoes.push(eventoStatement(context, requestId, "reaberto", "A cotação escolhida mudou; escolha confirmada de novo antes de comprar"));
    }
    await context.db.batch(instrucoes);
    return Response.json({ quoteId, ...(await detalharPedido(context, requestId)) }, { status: existente ? 200 : 201 });
  });
}
