import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  jsonBody,
  requireModulePermission,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const opportunitySchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  stage: z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/i).default("new"),
  estimatedValueCents: z.number().int().min(0).max(10_000_000_000).default(0),
  probabilityPercent: z.number().int().min(0).max(100).default(0),
  ownerMemberId: z.string().uuid().nullable().optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
});

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

async function owned(db: D1Database, table: "clients" | "members", id: string, organizationId: string) {
  return db.prepare(`SELECT id FROM ${table} WHERE id = ?1 AND organization_id = ?2`)
    .bind(id, organizationId).first<{ id: string }>();
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "crm", "view");
    const url = new URL(request.url);
    const stage = url.searchParams.get("stage")?.trim();
    const query = url.searchParams.get("q")?.trim().toLowerCase();
    const filters = ["o.organization_id = ?1"];
    const values: unknown[] = [context.organization.id];
    if (stage) { values.push(stage); filters.push(`o.stage = ?${values.length}`); }
    if (query) {
      values.push(`%${query}%`);
      filters.push(`(lower(o.title) LIKE ?${values.length} OR lower(COALESCE(c.name, '')) LIKE ?${values.length})`);
    }
    const result = await context.db.prepare(
      `${opportunitySelect} WHERE ${filters.join(" AND ")}
       ORDER BY CASE o.stage WHEN 'won' THEN 9 WHEN 'lost' THEN 10 ELSE 1 END,
       COALESCE(o.next_action_at, '9999-12-31'), o.updated_at DESC LIMIT 300`,
    ).bind(...values).all<OpportunityRow>();
    const stageRows = await context.db.prepare(
      "SELECT DISTINCT stage FROM crm_opportunities WHERE organization_id = ?1 ORDER BY stage",
    ).bind(context.organization.id).all<{ stage: string }>();
    const defaults = ["new", "diagnosis", "proposal", "negotiation", "won", "lost"];
    const stages = Array.from(new Set([...defaults, ...stageRows.results.map((row) => row.stage)]));
    return Response.json({ opportunities: result.results.map(opportunityResponse), stages });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "crm", "edit");
    const parsed = opportunitySchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    if (!await owned(context.db, "clients", data.clientId, context.organization.id)) {
      throw new ApiError(400, "invalid_client", "O cliente não pertence à empresa atual.");
    }
    if (data.ownerMemberId && !await owned(context.db, "members", data.ownerMemberId, context.organization.id)) {
      throw new ApiError(400, "invalid_owner", "O responsável não pertence à empresa atual.");
    }
    const id = crypto.randomUUID();
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO crm_opportunities (
          id, organization_id, client_id, title, stage, estimated_value_cents,
          probability_percent, owner_member_id, next_action, next_action_at,
          won_project_id, lost_reason, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(
        id, context.organization.id, data.clientId, data.title, data.stage,
        data.estimatedValueCents, data.probabilityPercent, data.ownerMemberId ?? null,
        data.nextAction ?? null, data.nextActionAt ?? null,
      ),
      auditStatement(context, "crm.opportunity_created", "crm_opportunity", id, {
        clientId: data.clientId,
        stage: data.stage,
      }),
    ]);
    const row = await context.db.prepare(`${opportunitySelect} WHERE o.id = ?1 AND o.organization_id = ?2`)
      .bind(id, context.organization.id).first<OpportunityRow>();
    return Response.json({ opportunity: opportunityResponse(row!) }, { status: 201 });
  });
}
