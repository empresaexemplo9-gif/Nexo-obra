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
    const current = ensureFound(await context.db.prepare("SELECT id, status, sent_at, approved_at, bdi_percent, margin_percent FROM budget_versions WHERE id = ?1 AND organization_id = ?2")
      .bind(budgetId, context.organization.id).first<BudgetState & { bdi_percent: number; margin_percent: number }>(), "Orçamento");
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
    // Mudar BDI ou margem num rascunho reprecifica os itens com preço automático (custo ×
    // fator); o preço digitado à mão fica. Antes a tela mostrava "BDI 25%" com o total antigo.
    const fator = (bdi: number, margem: number) => (1 + bdi / 100) * (1 + margem / 100);
    const antigo = fator(current.bdi_percent, current.margin_percent);
    const novo = fator(data.bdiPercent ?? current.bdi_percent, data.marginPercent ?? current.margin_percent);
    const reprecificar = current.status === "draft" && antigo !== novo;
    // O status atual entra no WHERE: aprovar e rejeitar ao mesmo tempo não podem os dois
    // responder 200 com o último vencendo em silêncio.
    const results = await context.db.batch([
      context.db.prepare(`UPDATE budget_versions SET ${columns.join(", ")} WHERE id = ?${values.length + 1} AND organization_id = ?${values.length + 2} AND status = ?${values.length + 3}`).bind(...values, budgetId, context.organization.id, current.status),
      ...(reprecificar ? [
        context.db.prepare(`UPDATE budget_items SET unit_price_cents = CAST(ROUND(unit_cost_cents * ?1) AS INTEGER)
          WHERE budget_version_id = ?2 AND unit_price_cents = CAST(ROUND(unit_cost_cents * ?3) AS INTEGER)
          AND EXISTS (SELECT 1 FROM budget_versions WHERE id = ?2 AND organization_id = ?4 AND status = 'draft')`).bind(novo, budgetId, antigo, context.organization.id),
        context.db.prepare(`UPDATE budget_versions SET total_cents = (SELECT COALESCE(ROUND(SUM(quantity * unit_price_cents)), 0) FROM budget_items WHERE budget_version_id = ?1) WHERE id = ?1 AND organization_id = ?2`).bind(budgetId, context.organization.id),
      ] : []),
      auditStatement(context, "budget.updated", "budget", budgetId, { fields: Object.keys(data), previousStatus: current.status, status: data.status ?? current.status }),
    ]);
    if (!results[0]?.meta?.changes) throw new ApiError(409, "budget_changed", "O orçamento mudou em outro acesso. Recarregue para ver a situação atual.");
    const budget = await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(budgetId, context.organization.id).first<BudgetRow>();
    if (!budget) throw new ApiError(404, "not_found", "Orçamento não encontrado.");
    return Response.json({ budget: budgetResponse(budget) });
  });
}
