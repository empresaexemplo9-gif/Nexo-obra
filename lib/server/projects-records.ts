export type ProjectRow = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  code: string;
  name: string;
  kind: "project" | "work";
  status: string;
  phase: string;
  progress_percent: number;
  owner_member_id: string | null;
  owner_name: string | null;
  start_date: string | null;
  target_date: string | null;
  budget_cents: number;
  external_financial_cost_center_id: string | null;
  created_at: string;
  updated_at: string;
};

export const projectSelect = `SELECT
  p.id, p.client_id, c.name AS client_name, p.code, p.name, p.kind,
  p.status, p.phase, p.progress_percent, p.owner_member_id,
  m.name AS owner_name, p.start_date, p.target_date, p.budget_cents,
  p.external_financial_cost_center_id, p.created_at, p.updated_at
  FROM projects p
  LEFT JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
  LEFT JOIN members m ON m.id = p.owner_member_id AND m.organization_id = p.organization_id`;

type ProjectResponseOptions = {
  includeClient?: boolean;
  includeBudget?: boolean;
  includeFinance?: boolean;
};

export function projectResponse(row: ProjectRow, options: ProjectResponseOptions = {}) {
  const {
    includeClient = true,
    includeBudget = true,
    includeFinance = true,
  } = options;
  return {
    id: row.id,
    clientId: includeClient ? row.client_id : null,
    clientName: includeClient ? row.client_name : null,
    code: row.code,
    name: row.name,
    kind: row.kind,
    status: row.status,
    phase: row.phase,
    progressPercent: row.progress_percent,
    ownerMemberId: row.owner_member_id,
    ownerName: row.owner_name,
    startDate: row.start_date,
    targetDate: row.target_date,
    budgetCents: includeBudget ? row.budget_cents : null,
    externalFinancialCostCenterId: includeFinance ? row.external_financial_cost_center_id : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

