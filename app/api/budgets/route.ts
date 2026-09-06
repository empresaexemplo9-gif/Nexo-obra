import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const createBudgetSchema = z.object({
  projectId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  bdiPercent: z.number().min(0).max(200).default(0),
  marginPercent: z.number().min(0).max(200).default(0),
});

export type BudgetRow = {
  id: string; project_id: string | null; project_name: string | null; code: string; version: number;
  status: string; direct_cost_cents: number; bdi_percent: number; margin_percent: number;
  total_cents: number; item_count: number; created_at: string; updated_at: string;
};

export const budgetSelect = `SELECT b.id, b.project_id, p.name AS project_name, b.code, b.version, b.status,
  b.direct_cost_cents, b.bdi_percent, b.margin_percent, b.total_cents,
  (SELECT COUNT(*) FROM budget_items i WHERE i.budget_version_id = b.id) AS item_count,
  b.created_at, b.updated_at
  FROM budget_versions b
  LEFT JOIN projects p ON p.id = b.project_id AND p.organization_id = b.organization_id`;

export function budgetResponse(row: BudgetRow) {
  return { id: row.id, projectId: row.project_id, projectName: row.project_name, code: row.code, version: row.version, status: row.status, directCostCents: row.direct_cost_cents, bdiPercent: row.bdi_percent, marginPercent: row.margin_percent, totalCents: row.total_cents, itemCount: row.item_count, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    const result = await context.db.prepare(`${budgetSelect} WHERE b.organization_id = ?1 ORDER BY b.updated_at DESC LIMIT 100`).bind(context.organization.id).all<BudgetRow>();
    return Response.json({ budgets: result.results.map(budgetResponse) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const parsed = createBudgetSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const project = await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2").bind(data.projectId, context.organization.id).first();
    if (!project) throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
    const current = await context.db.prepare("SELECT MAX(version) AS version FROM budget_versions WHERE organization_id = ?1 AND code = ?2").bind(context.organization.id, data.code).first<{ version: number | null }>();
    const version = (current?.version ?? 0) + 1;
    const id = crypto.randomUUID();
    try {
      await context.db.batch([
        context.db.prepare(`INSERT INTO budget_versions (id, organization_id, project_id, code, version, status, direct_cost_cents, bdi_percent, margin_percent, total_cents, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'draft', 0, ?6, ?7, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(id, context.organization.id, data.projectId, data.code, version, data.bdiPercent, data.marginPercent),
        auditStatement(context, "budget.created", "budget", id, { projectId: data.projectId, code: data.code, version }),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "budget_version_conflict", "Outra versão foi criada ao mesmo tempo. Tente novamente.");
      throw error;
    }
    const budget = await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(id, context.organization.id).first<BudgetRow>();
    return Response.json({ budget: budgetResponse(budget!) }, { status: 201 });
  });
}
