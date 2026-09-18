export type OpportunityRow = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  title: string;
  stage: string;
  estimated_value_cents: number;
  probability_percent: number;
  owner_member_id: string | null;
  owner_name: string | null;
  next_action: string | null;
  next_action_at: string | null;
  won_project_id: string | null;
  won_project_name: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
};

export const opportunitySelect = `SELECT
  o.id, o.client_id, c.name AS client_name, o.title, o.stage,
  o.estimated_value_cents, o.probability_percent, o.owner_member_id,
  m.name AS owner_name, o.next_action, o.next_action_at, o.won_project_id,
  p.name AS won_project_name, o.lost_reason, o.created_at, o.updated_at
  FROM crm_opportunities o
  LEFT JOIN clients c ON c.id = o.client_id AND c.organization_id = o.organization_id
  LEFT JOIN members m ON m.id = o.owner_member_id AND m.organization_id = o.organization_id
  LEFT JOIN projects p ON p.id = o.won_project_id AND p.organization_id = o.organization_id`;

export function opportunityResponse(row: OpportunityRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    title: row.title,
    stage: row.stage,
    estimatedValueCents: row.estimated_value_cents,
    probabilityPercent: row.probability_percent,
    ownerMemberId: row.owner_member_id,
    ownerName: row.owner_name,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    wonProjectId: row.won_project_id,
    wonProjectName: row.won_project_name,
    lostReason: row.lost_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

