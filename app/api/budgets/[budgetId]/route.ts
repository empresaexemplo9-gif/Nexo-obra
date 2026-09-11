import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { budgetResponse, budgetSelect, type BudgetRow } from "../route";

export const dynamic = "force-dynamic";

const updateBudgetSchema = z.object({
  status: z.enum(["draft", "sent", "approved", "rejected", "archived"]).optional(),
  bdiPercent: z.number().min(0).max(200).optional(),
  marginPercent: z.number().min(0).max(200).optional(),
}).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

type RouteContext = { params: Promise<{ budgetId: string }> };

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    const { budgetId } = await route.params;
    const budget = ensureFound(await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(budgetId, context.organization.id).first<BudgetRow>(), "Orçamento");
    return Response.json({ budget: budgetResponse(budget) });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const { budgetId } = await route.params;
    ensureFound(await context.db.prepare("SELECT id FROM budget_versions WHERE id = ?1 AND organization_id = ?2").bind(budgetId, context.organization.id).first(), "Orçamento");
    const parsed = updateBudgetSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const columns: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => { values.push(value); columns.push(`${column} = ?${values.length}`); };
    if (data.status !== undefined) {
      add("status", data.status);
      if (data.status === "sent") columns.push("sent_at = CURRENT_TIMESTAMP");
      if (data.status === "approved") columns.push("approved_at = CURRENT_TIMESTAMP");
    }
    if (data.bdiPercent !== undefined) add("bdi_percent", data.bdiPercent);
    if (data.marginPercent !== undefined) add("margin_percent", data.marginPercent);
    columns.push("updated_at = CURRENT_TIMESTAMP");
    await context.db.batch([
      context.db.prepare(`UPDATE budget_versions SET ${columns.join(", ")} WHERE id = ?${values.length + 1} AND organization_id = ?${values.length + 2}`).bind(...values, budgetId, context.organization.id),
      auditStatement(context, "budget.updated", "budget", budgetId, { fields: Object.keys(data) }),
    ]);
    const budget = await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(budgetId, context.organization.id).first<BudgetRow>();
    if (!budget) throw new ApiError(404, "not_found", "Orçamento não encontrado.");
    return Response.json({ budget: budgetResponse(budget) });
  });
}
