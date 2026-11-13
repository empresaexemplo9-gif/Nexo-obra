import { z } from "zod";

import {
  ApiError, apiRoute, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { centavos, dia, quantidade } from "@/lib/server/compras-entrada";
import { hojeDaEmpresa } from "@/lib/server/compras";
import { CENTRAL, saldoDe } from "@/lib/server/estoque";

export const dynamic = "force-dynamic";

const movimento = z.object({
  clientKey: z.string().uuid(),
  kind: z.enum(["entrada", "baixa"]),
  productId: z.string().uuid(),
  location: z.string().min(1).max(80),
  quantity: quantidade,
  unitCostCents: centavos.nullable().default(null),
  occurredOn: dia.optional(),
  note: z.string().trim().max(500).default(""),
}).strict().refine((m) => m.kind === "entrada" || m.note.length >= 3, { message: "Diga para onde foi o material (serviço, frente ou motivo).", path: ["note"] });

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

async function existente(context: Awaited<ReturnType<typeof requireOrganizationContext>>, clientKey: string) {
  return context.db.prepare("SELECT id, kind, quantity FROM stock_movements WHERE organization_id = ?1 AND client_key = ?2")
    .bind(context.organization.id, clientKey).first<{ id: string; kind: string; quantity: number }>();
}

// Entrada manual (doação, sobra de outra obra, compra fora do sistema) e baixa (material
// aplicado, perda, devolução). A baixa nunca deixa saldo negativo: a conferência e a
// gravação são a mesma instrução, então duas baixas simultâneas não passam juntas.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const parsed = movimento.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const m = parsed.data;
    const repetido = await existente(context, m.clientKey);
    if (repetido) return Response.json({ id: repetido.id, replayed: true });

    const produto = await context.db.prepare("SELECT id, name, unit FROM purchase_products WHERE id = ?1 AND organization_id = ?2 AND active = 1")
      .bind(m.productId, context.organization.id).first<{ id: string; name: string; unit: string }>();
    if (!produto) throw new ApiError(400, "product_not_found", "Produto não encontrado no cadastro desta empresa.");
    let projectId: string | null = null;
    if (m.location !== CENTRAL) {
      const projeto = await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2").bind(m.location, context.organization.id).first<{ id: string }>();
      if (!projeto) throw new ApiError(400, "project_not_found", "A obra informada não pertence a esta empresa.");
      projectId = projeto.id;
    }
    const hoje = hojeDaEmpresa(context);
    const quando = m.occurredOn ?? hoje;
    if (quando > hoje) throw validationError({ occurredOn: ["A data não pode estar no futuro."] });

    const id = crypto.randomUUID();
    const assinado = m.kind === "entrada" ? m.quantity : -m.quantity;
    const insercao = context.db.prepare(
      `INSERT INTO stock_movements (id, organization_id, product_id, project_id, kind, quantity, unit_cost_cents, source, request_id, client_key, note, occurred_on, author_name, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual', NULL, ?8, ?9, ?10, ?11, ?12
       WHERE ?5 = 'entrada' OR (SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE organization_id = ?2 AND product_id = ?3 AND COALESCE(project_id, 'central') = COALESCE(?4, 'central')) + ?6 >= -0.0000001`,
    ).bind(id, context.organization.id, produto.id, projectId, m.kind, assinado, m.kind === "entrada" ? m.unitCostCents : null, m.clientKey, m.note, quando, context.user.displayName, new Date().toISOString());
    const auditoria = context.db.prepare(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       SELECT ?1, ?2, ?3, ?4, 'stock_movement', ?5, ?6, ?7 WHERE changes() = 1`,
    ).bind(crypto.randomUUID(), context.organization.id, context.member.externalUserId, `stock.${m.kind}`, id, JSON.stringify({ productId: produto.id, location: m.location, quantity: m.quantity }), Date.now());
    let resultado;
    try { resultado = await context.db.batch([insercao, auditoria]); }
    catch (error) {
      if (String(error).includes("UNIQUE constraint")) { const r = await existente(context, m.clientKey); if (r) return Response.json({ id: r.id, replayed: true }); }
      throw error;
    }
    if (!resultado[0]?.meta?.changes) {
      const saldo = await saldoDe(context, produto.id, projectId);
      throw new ApiError(409, "insufficient_stock", `Saldo de ${produto.name} neste local é ${fmt(saldo)} ${produto.unit}; não dá para baixar ${fmt(m.quantity)}.`, { balance: saldo });
    }
    return Response.json({ id, balance: await saldoDe(context, produto.id, projectId) }, { status: 201 });
  });
}
