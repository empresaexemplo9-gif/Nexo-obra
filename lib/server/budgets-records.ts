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

