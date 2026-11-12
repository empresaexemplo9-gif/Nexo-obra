import { z } from "zod";

import {
  ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { acaoEntrada } from "@/lib/server/compras-entrada";
import { carregarPedido, detalharPedido, eventoStatement, exigirRevisao, gravarComRevisao, hojeDaEmpresa, itensDoPedido, totalDaCotacao } from "@/lib/server/compras";
import { rotuloStatus, somarDias, type StatusCompra } from "@/lib/compras";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

const dinheiro = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (dia: string) => dia.split("-").reverse().join("/");
const quantidade = (valor: number) => valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function exigirEtapa(atual: StatusCompra, permitidas: StatusCompra[], acao: string) {
  if (!permitidas.includes(atual)) {
    throw new ApiError(409, "invalid_transition", `Não é possível ${acao} um pedido em “${rotuloStatus[atual]}”.`);
  }
}

// Cada mudança de etapa é uma ação explícita, com revisão: duas pessoas não compram o
// mesmo pedido nem recebem o mesmo material duas vezes.
export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const { requestId } = await route.params;
    if (!z.string().uuid().safeParse(requestId).success) throw new ApiError(404, "not_found", "Pedido de compra não encontrado.");
    const parsed = acaoEntrada.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const acao = parsed.data;
    const pedido = await carregarPedido(context, requestId);
    exigirRevisao(pedido, acao.revision);
    const hoje = hojeDaEmpresa(context);
    const org = context.organization.id;

    // Primeira instrução sempre avança a revisão com a guarda; se outra pessoa passou na
    // frente, nada do lote é aplicado.
    const avancar = (sets: string, ...valores: unknown[]) => context.db.prepare(
      `UPDATE purchase_requests SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP, ${sets} WHERE id = ?1 AND organization_id = ?2 AND revision = ?3`,
    ).bind(requestId, org, acao.revision, ...valores);

    let lote;
    if (acao.action === "escolher") {
      exigirEtapa(pedido.status, ["a_orcar", "a_comprar"], "escolher fornecedor para");
      const { cotacao, faltando, totalCents } = await totalDaCotacao(context, requestId, acao.quoteId);
      if (faltando.length) throw new ApiError(400, "quote_incomplete", `A cotação não tem preço para ${faltando.length} ${faltando.length === 1 ? "item" : "itens"}. Complete-a ou retire o item do pedido.`);
      if (cotacao.valid_until && cotacao.valid_until < hoje) throw new ApiError(400, "quote_expired", "A validade desta cotação venceu. Confirme o preço com o fornecedor e atualize a validade.");
      const nome = await context.db.prepare("SELECT name FROM suppliers WHERE id = ?1 AND organization_id = ?2").bind(cotacao.supplier_id, org).first<{ name: string }>();
      lote = [
        avancar("status = 'a_comprar', selected_quote_id = ?4", acao.quoteId),
        eventoStatement(context, requestId, "escolhido", `Fornecedor escolhido: ${nome?.name ?? "—"} · ${dinheiro(totalCents)} · entrega em ${cotacao.delivery_days} dias`),
      ];
    } else if (acao.action === "reabrir") {
      exigirEtapa(pedido.status, ["a_comprar"], "reabrir a escolha de");
      lote = [avancar("status = 'a_orcar', selected_quote_id = NULL"), eventoStatement(context, requestId, "reaberto", "Escolha do fornecedor reaberta")];
    } else if (acao.action === "comprar") {
      exigirEtapa(pedido.status, ["a_comprar"], "fazer o pedido de");
      if (!pedido.selected_quote_id) throw new ApiError(409, "quote_not_selected", "Escolha a cotação antes de comprar.");
      const { cotacao, faltando, totalCents } = await totalDaCotacao(context, requestId, pedido.selected_quote_id);
      if (faltando.length) throw new ApiError(409, "quote_incomplete", "A cotação escolhida deixou de cobrir todos os itens. Escolha de novo.");
      const pedidoEm = acao.orderedAt ?? hoje;
      if (pedidoEm > hoje) throw validationError({ orderedAt: ["A data do pedido não pode estar no futuro."] });
      const previsao = acao.expectedDeliveryDate === undefined ? somarDias(pedidoEm, Number(cotacao.delivery_days)) : acao.expectedDeliveryDate;
      lote = [
        avancar("status = 'comprado', ordered_at = ?4, purchased_total_cents = ?5, expected_delivery_date = ?6, order_number = ?7", pedidoEm, totalCents, previsao, acao.orderNumber),
        eventoStatement(context, requestId, "comprado", `Pedido feito em ${data(pedidoEm)}${acao.orderNumber ? ` · nº ${acao.orderNumber}` : ""} · ${dinheiro(totalCents)}${previsao ? ` · previsão ${data(previsao)}` : ""}`),
      ];
    } else if (acao.action === "despachar") {
      exigirEtapa(pedido.status, ["comprado"], "registrar o envio de");
      const previsao = acao.expectedDeliveryDate === undefined ? pedido.expected_delivery_date : acao.expectedDeliveryDate;
      lote = [
        avancar("status = 'em_entrega', dispatched_at = ?4, carrier = ?5, tracking_code = ?6, expected_delivery_date = ?7", hoje, acao.carrier, acao.trackingCode, previsao),
        eventoStatement(context, requestId, "despachado", `Saiu do fornecedor${acao.carrier ? ` · ${acao.carrier}` : ""}${acao.trackingCode ? ` · rastreio ${acao.trackingCode}` : ""}${previsao ? ` · previsão ${data(previsao)}` : ""}`),
      ];
    } else if (acao.action === "receber") {
      exigirEtapa(pedido.status, ["comprado", "em_entrega"], "receber material de");
      const recebidoEm = acao.receivedAt ?? hoje;
      if (recebidoEm > hoje) throw validationError({ receivedAt: ["A data de recebimento não pode estar no futuro."] });
      const itens = await itensDoPedido(context, [requestId]);
      const porId = new Map(itens.map((item) => [item.id, item]));
      const atualizado = new Map(itens.map((item) => [item.id, Number(item.received_quantity)]));
      const linhas: string[] = [];
      for (const entrada of acao.items) {
        const item = porId.get(entrada.itemId);
        if (!item) throw new ApiError(400, "item_not_found", "Um dos itens não pertence a este pedido.");
        const total = Math.round((atualizado.get(item.id)! + entrada.quantity) * 1000) / 1000;
        if (total > Number(item.quantity) + 1e-9) {
          throw validationError({ items: [`${item.description}: recebido ${quantidade(total)} ${item.unit}, mas o pedido tem ${quantidade(Number(item.quantity))}.`] });
        }
        atualizado.set(item.id, total);
        linhas.push(`${quantidade(entrada.quantity)} ${item.unit} de ${item.description}`);
      }
      const completo = itens.every((item) => atualizado.get(item.id)! >= Number(item.quantity) - 1e-9);
      lote = [
        completo
          ? avancar("status = 'entregue', delivered_at = ?4", recebidoEm)
          : avancar("status = 'em_entrega', dispatched_at = COALESCE(dispatched_at, ?4)", recebidoEm),
        ...itens.filter((item) => atualizado.get(item.id) !== Number(item.received_quantity)).map((item) =>
          context.db.prepare("UPDATE purchase_request_items SET received_quantity = ?1 WHERE id = ?2 AND request_id = ?3 AND organization_id = ?4")
            .bind(atualizado.get(item.id), item.id, requestId, org)),
        eventoStatement(context, requestId, completo ? "entregue" : "recebido_parcial", `${completo ? "Entrega concluída" : "Recebido em parte"} em ${data(recebidoEm)}: ${linhas.join("; ")}${acao.note ? ` · ${acao.note}` : ""}`),
      ];
    } else {
      exigirEtapa(pedido.status, ["a_orcar", "a_comprar", "comprado", "em_entrega"], "cancelar");
      lote = [avancar("status = 'cancelado', cancel_reason = ?4", acao.reason), eventoStatement(context, requestId, "cancelado", `Cancelado: ${acao.reason}`)];
    }

    lote.push(auditStatement(context, `purchase_request.${acao.action}`, "purchase_request", requestId, { from: pedido.status }));
    await gravarComRevisao(context, lote);
    return Response.json(await detalharPedido(context, requestId));
  });
}
