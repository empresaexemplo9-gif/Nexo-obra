import {
  ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { pedidoNovo } from "@/lib/server/compras-entrada";
import { eventoStatement, exigirProjetoDaEmpresa, hojeDaEmpresa, listarPedidos } from "@/lib/server/compras";
import { numeroDoPedido } from "@/lib/compras";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    const projectId = new URL(request.url).searchParams.get("projectId");
    const requests = await listarPedidos(context, { projectId: projectId || null });
    return Response.json({
      requests,
      today: hojeDaEmpresa(context),
      canEdit: context.member.permissions.purchases.edit,
      canImportBudget: context.member.permissions.budgets.view,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

type ItemNovo = { productId: string | null; description: string; unit: string; quantity: number; referenceCostCents: number | null };

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const parsed = pedidoNovo.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    let projectId = data.projectId;
    await exigirProjetoDaEmpresa(context, projectId);

    const itens: ItemNovo[] = [];
    // Produto escolhido do cadastro: descrição, unidade e custo de referência vêm do banco.
    const produtoIds = [...new Set(data.items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
    const produtos = new Map<string, { id: string; unit: string; reference_cost_cents: number | null }>();
    for (const id of produtoIds) {
      const produto = await context.db.prepare("SELECT id, unit, reference_cost_cents FROM purchase_products WHERE id = ?1 AND organization_id = ?2 AND active = 1")
        .bind(id, context.organization.id).first<{ id: string; unit: string; reference_cost_cents: number | null }>();
      if (!produto) throw new ApiError(400, "product_not_found", "Um dos produtos não pertence ao cadastro desta empresa.");
      produtos.set(id, produto);
    }
    for (const item of data.items) {
      const produto = item.productId ? produtos.get(item.productId)! : null;
      itens.push({ productId: produto?.id ?? null, description: item.description, unit: produto?.unit ?? item.unit, quantity: item.quantity, referenceCostCents: produto?.reference_cost_cents ?? null });
    }

    let origem = "";
    if (data.budgetVersionId) {
      // Copiar itens do orçamento é ler dado de Orçamentos: exige a leitura daquele módulo.
      requireModulePermission(context, "budgets", "view");
      const orcamento = await context.db.prepare("SELECT id, code, version, project_id FROM budget_versions WHERE id = ?1 AND organization_id = ?2")
        .bind(data.budgetVersionId, context.organization.id).first<{ id: string; code: string; version: number; project_id: string | null }>();
      if (!orcamento) throw new ApiError(404, "budget_not_found", "Orçamento não encontrado nesta empresa.");
      const { results } = await context.db.prepare("SELECT description, unit, quantity, unit_cost_cents FROM budget_items WHERE budget_version_id = ?1 AND parent_item_id IS NULL ORDER BY sort_order LIMIT 200")
        .bind(orcamento.id).all<{ description: string; unit: string; quantity: number; unit_cost_cents: number }>();
      for (const item of results) {
        if (!(Number(item.quantity) > 0)) continue;
        itens.push({ productId: null, description: item.description.slice(0, 300), unit: item.unit.slice(0, 16), quantity: Math.round(Number(item.quantity) * 1000) / 1000, referenceCostCents: Number(item.unit_cost_cents) || null });
      }
      projectId = projectId ?? orcamento.project_id;
      origem = ` · itens do orçamento ${orcamento.code} v${orcamento.version}`;
    }
    if (itens.length > 200) throw validationError({ items: ["Um pedido aceita até 200 itens."] });

    const id = crypto.randomUUID();
    // Número sequencial por empresa. Dois pedidos criados no mesmo instante disputam o
    // número; o índice único recusa o segundo e ele tenta o próximo.
    for (let tentativa = 0; tentativa < 4; tentativa += 1) {
      const proximo = await context.db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM purchase_requests WHERE organization_id = ?1")
        .bind(context.organization.id).first<{ n: number }>();
      const numero = Number(proximo?.n ?? 1) + tentativa;
      try {
        await context.db.batch([
          context.db.prepare(
            `INSERT INTO purchase_requests (id, organization_id, number, project_id, title, status, priority, needed_by, delivery_address, notes, revision, created_by_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'a_orcar', ?6, ?7, ?8, ?9, 1, ?10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          ).bind(id, context.organization.id, numero, projectId, data.title, data.priority, data.neededBy, data.deliveryAddress, data.notes, context.user.displayName),
          ...itens.map((item, position) => context.db.prepare(
            `INSERT INTO purchase_request_items (id, organization_id, request_id, product_id, position, description, unit, quantity, received_quantity, reference_cost_cents)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`,
          ).bind(crypto.randomUUID(), context.organization.id, id, item.productId, position, item.description, item.unit, item.quantity, item.referenceCostCents)),
          eventoStatement(context, id, "criado", `${numeroDoPedido(numero)} criado com ${itens.length} ${itens.length === 1 ? "item" : "itens"}${origem}`),
          auditStatement(context, "purchase_request.created", "purchase_request", id, { number: numero, items: itens.length }),
        ]);
        return Response.json({ created: true, id, code: numeroDoPedido(numero) }, { status: 201 });
      } catch (error) {
        if (!String(error).includes("UNIQUE constraint") || tentativa === 3) throw error;
      }
    }
    throw new ApiError(409, "purchase_number_conflict", "Não foi possível numerar o pedido. Tente de novo.");
  });
}
