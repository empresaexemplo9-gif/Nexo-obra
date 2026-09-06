import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const itemSchema = z.object({
  code: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().min(2).max(300),
  unit: z.string().trim().min(1).max(16).default("un"),
  quantity: z.number().positive().max(1_000_000).default(1),
  unitCostCents: z.number().int().nonnegative().default(0),
  unitPriceCents: z.number().int().nonnegative().nullable().optional(),
  source: z.enum(["manual", "library", "sinapi"]).default("manual"),
  sourceReference: z.string().trim().max(180).nullable().optional(),
});
const bulkSchema = z.object({ items: z.array(itemSchema).min(1).max(200) });

type RouteContext = { params: Promise<{ budgetId: string }> };
type ItemRow = { id: string; code: string | null; description: string; unit: string; quantity: number; unit_cost_cents: number; unit_price_cents: number; source: string; source_reference: string | null; sort_order: number };

function response(row: ItemRow) {
  return { id: row.id, code: row.code, description: row.description, unit: row.unit, quantity: row.quantity, unitCostCents: row.unit_cost_cents, unitPriceCents: row.unit_price_cents, source: row.source, sourceReference: row.source_reference, sortOrder: row.sort_order, totalCents: Math.round(row.quantity * row.unit_price_cents) };
}

async function ownedBudget(db: D1Database, budgetId: string, organizationId: string) {
  return db.prepare("SELECT id, bdi_percent, margin_percent FROM budget_versions WHERE id = ?1 AND organization_id = ?2").bind(budgetId, organizationId).first<{ id: string; bdi_percent: number; margin_percent: number }>();
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    const { budgetId } = await route.params;
    if (!await ownedBudget(context.db, budgetId, context.organization.id)) throw new ApiError(404, "not_found", "Orçamento não encontrado.");
    const result = await context.db.prepare("SELECT id, code, description, unit, quantity, unit_cost_cents, unit_price_cents, source, source_reference, sort_order FROM budget_items WHERE budget_version_id = ?1 ORDER BY sort_order, description").bind(budgetId).all<ItemRow>();
    return Response.json({ items: result.results.map(response) });
  });
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const { budgetId } = await route.params;
    const budget = await ownedBudget(context.db, budgetId, context.organization.id);
    if (!budget) throw new ApiError(404, "not_found", "Orçamento não encontrado.");
    const parsed = bulkSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const current = await context.db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM budget_items WHERE budget_version_id = ?1").bind(budgetId).first<{ max_order: number }>();
    const statements = parsed.data.items.map((item, index) => {
      const factor = (1 + budget.bdi_percent / 100) * (1 + budget.margin_percent / 100);
      const unitPrice = item.unitPriceCents ?? Math.round(item.unitCostCents * factor);
      return context.db.prepare(`INSERT INTO budget_items (id, budget_version_id, parent_item_id, sort_order, code, description, unit, quantity, unit_cost_cents, unit_price_cents, source, source_reference) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`).bind(crypto.randomUUID(), budgetId, (current?.max_order ?? -1) + index + 1, item.code ?? null, item.description, item.unit, item.quantity, item.unitCostCents, unitPrice, item.source, item.sourceReference ?? null);
    });
    statements.push(context.db.prepare(`UPDATE budget_versions SET direct_cost_cents = (SELECT COALESCE(ROUND(SUM(quantity * unit_cost_cents)), 0) FROM budget_items WHERE budget_version_id = ?1), total_cents = (SELECT COALESCE(ROUND(SUM(quantity * unit_price_cents)), 0) FROM budget_items WHERE budget_version_id = ?1), updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND organization_id = ?2`).bind(budgetId, context.organization.id));
    statements.push(auditStatement(context, "budget.items_added", "budget", budgetId, { count: parsed.data.items.length }));
    await context.db.batch(statements);
    const result = await context.db.prepare("SELECT id, code, description, unit, quantity, unit_cost_cents, unit_price_cents, source, source_reference, sort_order FROM budget_items WHERE budget_version_id = ?1 ORDER BY sort_order, description").bind(budgetId).all<ItemRow>();
    return Response.json({ items: result.results.map(response) }, { status: 201 });
  });
}
