import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { budgetResponse, budgetSelect, type BudgetRow } from "@/lib/server/budgets-records";

export const dynamic = "force-dynamic";

const updateBudgetSchema = z.object({
  status: z.enum(["draft", "sent", "approved", "rejected", "archived"]).optional(),
  bdiPercent: z.number().min(0).max(200).optional(),
  marginPercent: z.number().min(0).max(200).optional(),
}).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

type RouteContext = { params: Promise<{ budgetId: string }> };

type BudgetState = { id: string; status: string; sent_at: string | null; approved_at: string | null };

const allowedTransitions: Record<string, readonly string[]> = {
  draft: ["sent", "archived"],
  sent: ["approved", "rejected", "archived"],
  approved: ["archived"],
  rejected: ["archived"],
  archived: [],
};

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
    const current = ensureFound(await context.db.prepare("SELECT id, status, sent_at, approved_at FROM budget_versions WHERE id = ?1 AND organization_id = ?2")
      .bind(budgetId, context.organization.id).first<BudgetState>(), "Orçamento");
    const parsed = updateBudgetSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;

    if (current.status !== "draft" && (data.bdiPercent !== undefined || data.marginPercent !== undefined)) {
      throw new ApiError(409, "budget_locked", "O orçamento foi enviado e está imutável. Crie uma nova versão para alterar valores, BDI ou margem.");
    }
    if (data.status && data.status !== current.status) {
      if (!(allowedTransitions[current.status] ?? []).includes(data.status)) {
        throw new ApiError(409, "invalid_budget_transition", `Não é possível mudar um orçamento ${current.status} para ${data.status}.`);
      }
      if (data.status === "sent") {
        const count = await context.db.prepare("SELECT COUNT(*) AS total FROM budget_items WHERE budget_version_id = ?1")
          .bind(budgetId).first<{ total: number }>();
        if ((count?.total ?? 0) === 0) throw new ApiError(409, "empty_budget", "Inclua ao menos um item antes de enviar o orçamento.");
      }
    }

    const columns: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => { values.push(value); columns.push(`${column} = ?${values.length}`); };
    if (data.status !== undefined && data.status !== current.status) {
      add("status", data.status);
      if (data.status === "sent") columns.push("sent_at = CURRENT_TIMESTAMP");
      if (data.status === "approved") columns.push("approved_at = CURRENT_TIMESTAMP");
    }
    if (data.bdiPercent !== undefined) add("bdi_percent", data.bdiPercent);
    if (data.marginPercent !== undefined) add("margin_percent", data.marginPercent);
    if (!columns.length) return Response.json({ budget: budgetResponse(ensureFound(await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(budgetId, context.organization.id).first<BudgetRow>(), "Orçamento")) });
    columns.push("updated_at = CURRENT_TIMESTAMP");
    await context.db.batch([
      context.db.prepare(`UPDATE budget_versions SET ${columns.join(", ")} WHERE id = ?${values.length + 1} AND organization_id = ?${values.length + 2}`).bind(...values, budgetId, context.organization.id),
      auditStatement(context, "budget.updated", "budget", budgetId, { fields: Object.keys(data), previousStatus: current.status, status: data.status ?? current.status }),
    ]);
    const budget = await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(budgetId, context.organization.id).first<BudgetRow>();
    if (!budget) throw new ApiError(404, "not_found", "Orçamento não encontrado.");
    return Response.json({ budget: budgetResponse(budget) });
  });
}
