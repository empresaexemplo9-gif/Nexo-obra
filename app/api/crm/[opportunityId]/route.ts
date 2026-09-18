import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  ensureFound,
  jsonBody,
  requireModulePermission,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";
import { opportunityResponse, opportunitySelect, type OpportunityRow } from "@/lib/server/crm-records";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ opportunityId: string }> };

const updateSchema = z.object({
  clientId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(200).optional(),
  stage: z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/i).optional(),
  estimatedValueCents: z.number().int().min(0).max(10_000_000_000).optional(),
  probabilityPercent: z.number().int().min(0).max(100).optional(),
  ownerMemberId: z.string().uuid().nullable().optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionAt: z.string().datetime({ offset: true }).nullable().optional(),
  lostReason: z.string().trim().max(800).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

const convertSchema = z.object({
  code: z.string().trim().min(2).max(24),
  projectName: z.string().trim().min(3).max(160).optional(),
  kind: z.enum(["project", "work"]).default("project"),
  phase: z.string().trim().min(2).max(80).default("briefing"),
  targetDate: z.string().date().nullable().optional(),
});

async function record(context: Awaited<ReturnType<typeof requireOrganizationContext>>, id: string) {
  return ensureFound(await context.db.prepare(`${opportunitySelect} WHERE o.id = ?1 AND o.organization_id = ?2`)
    .bind(id, context.organization.id).first<OpportunityRow>(), "Oportunidade");
}

async function owned(db: D1Database, table: "clients" | "members", id: string, organizationId: string) {
  return db.prepare(`SELECT id FROM ${table} WHERE id = ?1 AND organization_id = ?2`)
    .bind(id, organizationId).first<{ id: string }>();
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "crm", "view");
    const { opportunityId } = await route.params;
    return Response.json({ opportunity: opportunityResponse(await record(context, opportunityId)) });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "crm", "edit");
    const { opportunityId } = await route.params;
    const current = await record(context, opportunityId);
    if (current.won_project_id) throw new ApiError(409, "opportunity_converted", "Esta oportunidade já foi convertida em projeto.");
    const parsed = updateSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    if (data.clientId && !await owned(context.db, "clients", data.clientId, context.organization.id)) {
      throw new ApiError(400, "invalid_client", "O cliente não pertence à empresa atual.");
    }
    if (data.ownerMemberId && !await owned(context.db, "members", data.ownerMemberId, context.organization.id)) {
      throw new ApiError(400, "invalid_owner", "O responsável não pertence à empresa atual.");
    }
    const columns: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => { values.push(value); columns.push(`${column} = ?${values.length}`); };
    if (data.clientId !== undefined) add("client_id", data.clientId);
    if (data.title !== undefined) add("title", data.title);
    if (data.stage !== undefined) add("stage", data.stage);
    if (data.estimatedValueCents !== undefined) add("estimated_value_cents", data.estimatedValueCents);
    if (data.probabilityPercent !== undefined) add("probability_percent", data.probabilityPercent);
    if (data.ownerMemberId !== undefined) add("owner_member_id", data.ownerMemberId);
    if (data.nextAction !== undefined) add("next_action", data.nextAction);
    if (data.nextActionAt !== undefined) add("next_action_at", data.nextActionAt);
    if (data.lostReason !== undefined) add("lost_reason", data.lostReason);
    columns.push("updated_at = CURRENT_TIMESTAMP");
    await context.db.batch([
      context.db.prepare(`UPDATE crm_opportunities SET ${columns.join(", ")} WHERE id = ?${values.length + 1} AND organization_id = ?${values.length + 2}`)
        .bind(...values, opportunityId, context.organization.id),
      auditStatement(context, "crm.opportunity_updated", "crm_opportunity", opportunityId, { fields: Object.keys(data) }),
    ]);
    return Response.json({ opportunity: opportunityResponse(await record(context, opportunityId)) });
  });
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "crm", "edit");
    requireModulePermission(context, "projects", "edit");
    const { opportunityId } = await route.params;
    const current = await record(context, opportunityId);
    if (current.won_project_id) throw new ApiError(409, "opportunity_converted", "Esta oportunidade já foi convertida em projeto.");
    if (!current.client_id) throw new ApiError(409, "client_required", "Associe um cliente antes de converter a oportunidade.");
    const parsed = convertSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const duplicate = await context.db.prepare("SELECT id FROM projects WHERE organization_id = ?1 AND code = ?2")
      .bind(context.organization.id, data.code).first();
    if (duplicate) throw new ApiError(409, "project_code_conflict", "Este código de projeto já está em uso.");
    const projectId = crypto.randomUUID();
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO projects (
          id, organization_id, client_id, code, name,
          type, kind, status, stage, phase, progress, progress_percent,
          owner_member_id, starts_at, start_date, deadline_at, target_date,
          budget_cents, drap_cost_center_id, external_financial_cost_center_id,
          created_at, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5,
          ?6, ?6, 'active', ?7, ?7, 0, 0,
          ?8, NULL, NULL, ?9, ?9,
          ?10, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
      ).bind(
        projectId, context.organization.id, current.client_id, data.code,
        data.projectName ?? current.title, data.kind, data.phase,
        current.owner_member_id, data.targetDate ?? null, current.estimated_value_cents,
      ),
      context.db.prepare("UPDATE crm_opportunities SET stage = 'won', probability_percent = 100, won_project_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND organization_id = ?3")
        .bind(projectId, opportunityId, context.organization.id),
      auditStatement(context, "crm.opportunity_converted", "crm_opportunity", opportunityId, { projectId }),
      auditStatement(context, "project.created_from_crm", "project", projectId, { opportunityId }),
    ]);
    return Response.json({ projectId, opportunity: opportunityResponse(await record(context, opportunityId)) }, { status: 201 });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "crm", "edit");
    const { opportunityId } = await route.params;
    const current = await record(context, opportunityId);
    if (current.won_project_id) throw new ApiError(409, "opportunity_converted", "Oportunidades convertidas não podem ser excluídas; arquive pelo estágio.");
    await context.db.batch([
      context.db.prepare("DELETE FROM crm_opportunities WHERE id = ?1 AND organization_id = ?2").bind(opportunityId, context.organization.id),
      auditStatement(context, "crm.opportunity_deleted", "crm_opportunity", opportunityId),
    ]);
    return new Response(null, { status: 204 });
  });
}
