import { z } from "zod";

import {
  ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { pedidoAlteracao } from "@/lib/server/compras-entrada";
import { carregarPedido, detalharPedido, eventoStatement, exigirProjetoDaEmpresa, exigirRevisao, gravarComRevisao, itensDoPedido } from "@/lib/server/compras";
import { itensEditaveis, logisticaEditavel, encerrada } from "@/lib/compras";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };

async function idDaRota(route: RouteContext) {
  const { requestId } = await route.params;
  if (!z.string().uuid().safeParse(requestId).success) throw new ApiError(404, "not_found", "Pedido de compra não encontrado.");
  return requestId;
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    return Response.json(await detalharPedido(context, await idDaRota(route)), { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const id = await idDaRota(route);
    const parsed = pedidoAlteracao.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const pedido = await carregarPedido(context, id);
    exigirRevisao(pedido, data.revision);
    if (encerrada(pedido.status)) throw new ApiError(409, "purchase_closed", "Pedido entregue ou cancelado não muda mais.");
    if (data.projectId !== undefined) await exigirProjetoDaEmpresa(context, data.projectId);

    const logistica = data.orderNumber !== undefined || data.expectedDeliveryDate !== undefined || data.carrier !== undefined || data.trackingCode !== undefined;
    if (logistica && !logisticaEditavel(pedido.status)) {
      throw new ApiError(409, "logistics_not_open", "Número do pedido, transportadora e previsão de entrega são preenchidos depois da compra.");
    }
    if (data.items && !itensEditaveis(pedido.status)) {
      throw new ApiError(409, "items_locked", "Os itens só mudam enquanto o pedido está em “A orçar”. Reabra a escolha para alterar.");
    }

    const instrucoes = [];
    const mudou: string[] = [];
    if (data.items) {
      const atuais = await itensDoPedido(context, [id]);
      const atuaisPorId = new Map(atuais.map((item) => [item.id, item]));
      const mantidos = new Set<string>();
      for (const [position, item] of data.items.entries()) {
        if (item.id) {
          if (!atuaisPorId.has(item.id)) throw new ApiError(400, "item_not_found", "Um dos itens não pertence a este pedido.");
          mantidos.add(item.id);
          instrucoes.push(context.db.prepare("UPDATE purchase_request_items SET position = ?1, description = ?2, unit = ?3, quantity = ?4 WHERE id = ?5 AND request_id = ?6 AND organization_id = ?7")
            .bind(position, item.description, item.unit, item.quantity, item.id, id, context.organization.id));
        } else {
          let referencia: number | null = null; let unidade = item.unit; let produto: string | null = null;
          if (item.productId) {
            const encontrado = await context.db.prepare("SELECT id, unit, reference_cost_cents FROM purchase_products WHERE id = ?1 AND organization_id = ?2 AND active = 1")
              .bind(item.productId, context.organization.id).first<{ id: string; unit: string; reference_cost_cents: number | null }>();
            if (!encontrado) throw new ApiError(400, "product_not_found", "Um dos produtos não pertence ao cadastro desta empresa.");
            referencia = encontrado.reference_cost_cents; unidade = encontrado.unit; produto = encontrado.id;
          }
          instrucoes.push(context.db.prepare(
            `INSERT INTO purchase_request_items (id, organization_id, request_id, product_id, position, description, unit, quantity, received_quantity, reference_cost_cents)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`,
          ).bind(crypto.randomUUID(), context.organization.id, id, produto, position, item.description, unidade, item.quantity, referencia));
        }
      }
      // Item removido leva junto os preços que as cotações tinham para ele.
      for (const removido of atuais.filter((item) => !mantidos.has(item.id))) {
        instrucoes.push(context.db.prepare("DELETE FROM purchase_quote_items WHERE request_item_id = ?1 AND organization_id = ?2").bind(removido.id, context.organization.id));
        instrucoes.push(context.db.prepare("DELETE FROM purchase_request_items WHERE id = ?1 AND organization_id = ?2").bind(removido.id, context.organization.id));
      }
      mudou.push("itens");
    }

    const campos: [string, unknown][] = [];
    if (data.title !== undefined) campos.push(["title", data.title]);
    if (data.projectId !== undefined) campos.push(["project_id", data.projectId]);
    if (data.neededBy !== undefined) campos.push(["needed_by", data.neededBy]);
    if (data.priority !== undefined) campos.push(["priority", data.priority]);
    if (data.deliveryAddress !== undefined) campos.push(["delivery_address", data.deliveryAddress]);
    if (data.notes !== undefined) campos.push(["notes", data.notes]);
    if (data.orderNumber !== undefined) campos.push(["order_number", data.orderNumber]);
    if (data.expectedDeliveryDate !== undefined) campos.push(["expected_delivery_date", data.expectedDeliveryDate]);
    if (data.carrier !== undefined) campos.push(["carrier", data.carrier]);
    if (data.trackingCode !== undefined) campos.push(["tracking_code", data.trackingCode]);
    const atribuicoes = campos.map(([coluna], i) => `${coluna} = ?${i + 4}`);
    instrucoes.unshift(context.db.prepare(
      `UPDATE purchase_requests SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP${atribuicoes.length ? `, ${atribuicoes.join(", ")}` : ""}
       WHERE id = ?1 AND organization_id = ?2 AND revision = ?3`,
    ).bind(id, context.organization.id, data.revision, ...campos.map(([, valor]) => valor)));

    if (data.expectedDeliveryDate !== undefined && data.expectedDeliveryDate !== pedido.expected_delivery_date) {
      instrucoes.push(eventoStatement(context, id, "previsao", data.expectedDeliveryDate ? `Previsão de entrega alterada para ${data.expectedDeliveryDate.split("-").reverse().join("/")}` : "Previsão de entrega removida"));
    }
    if (campos.length) mudou.push(...campos.map(([coluna]) => coluna));
    instrucoes.push(auditStatement(context, "purchase_request.updated", "purchase_request", id, { fields: mudou }));
    await gravarComRevisao(context, instrucoes);
    return Response.json(await detalharPedido(context, id));
  });
}
