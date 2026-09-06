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
import { projectResponse, projectSelect, type ProjectRow } from "../route";

export const dynamic = "force-dynamic";

const updateProjectSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(2).max(24).optional(),
  name: z.string().trim().min(3).max(160).optional(),
  kind: z.enum(["project", "work"]).optional(),
  status: z.enum(["active", "on_hold", "completed", "archived"]).optional(),
  phase: z.string().trim().min(2).max(80).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  ownerMemberId: z.string().uuid().nullable().optional(),
  startDate: z.string().date().nullable().optional(),
  targetDate: z.string().date().nullable().optional(),
  budgetCents: z.number().int().nonnegative().optional(),
  externalFinancialCostCenterId: z.string().trim().max(120).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

type RouteContext = { params: Promise<{ projectId: string }> };

async function verifyRelation(db: D1Database, table: "clients" | "members", id: string | null, orgId: string) {
  if (!id) return;
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?1 AND organization_id = ?2`)
    .bind(id, orgId).first();
  if (!row) throw new ApiError(400, "invalid_relation", "O vínculo informado não pertence à empresa atual.");
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "projects", "view");
    const { projectId } = await route.params;
    const project = ensureFound(
      await context.db.prepare(`${projectSelect} WHERE p.id = ?1 AND p.organization_id = ?2`)
        .bind(projectId, context.organization.id).first<ProjectRow>(),
      "Projeto",
    );
    return Response.json({ project: projectResponse(project) });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "projects", "edit");
    const { projectId } = await route.params;
    ensureFound(
      await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2")
        .bind(projectId, context.organization.id).first(),
      "Projeto",
    );
    const parsed = updateProjectSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    if (data.clientId !== undefined) await verifyRelation(context.db, "clients", data.clientId, context.organization.id);
    if (data.ownerMemberId !== undefined) await verifyRelation(context.db, "members", data.ownerMemberId, context.organization.id);

    const columns: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      columns.push(`${column} = ?${values.length + 1}`);
      values.push(value);
    };
    if (data.clientId !== undefined) add("client_id", data.clientId);
    if (data.code !== undefined) add("code", data.code);
    if (data.name !== undefined) add("name", data.name);
    if (data.kind !== undefined) { add("kind", data.kind); add("type", data.kind); }
    if (data.status !== undefined) add("status", data.status);
    if (data.phase !== undefined) { add("phase", data.phase); add("stage", data.phase); }
    if (data.progressPercent !== undefined) { add("progress_percent", data.progressPercent); add("progress", data.progressPercent); }
    if (data.ownerMemberId !== undefined) add("owner_member_id", data.ownerMemberId);
    if (data.startDate !== undefined) { add("start_date", data.startDate); add("starts_at", data.startDate); }
    if (data.targetDate !== undefined) { add("target_date", data.targetDate); add("deadline_at", data.targetDate); }
    if (data.budgetCents !== undefined) add("budget_cents", data.budgetCents);
    if (data.externalFinancialCostCenterId !== undefined) {
      add("external_financial_cost_center_id", data.externalFinancialCostCenterId);
      add("drap_cost_center_id", data.externalFinancialCostCenterId);
    }
    columns.push("updated_at = CURRENT_TIMESTAMP");
    const idPosition = values.length + 1;
    const orgPosition = values.length + 2;

    await context.db.batch([
      context.db.prepare(`UPDATE projects SET ${columns.join(", ")} WHERE id = ?${idPosition} AND organization_id = ?${orgPosition}`)
        .bind(...values, projectId, context.organization.id),
      auditStatement(context, "project.updated", "project", projectId, { fields: Object.keys(data) }),
    ]);

    const project = ensureFound(
      await context.db.prepare(`${projectSelect} WHERE p.id = ?1 AND p.organization_id = ?2`)
        .bind(projectId, context.organization.id).first<ProjectRow>(),
      "Projeto",
    );
    return Response.json({ project: projectResponse(project) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "projects", "edit");
    const { projectId } = await route.params;
    ensureFound(
      await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2")
        .bind(projectId, context.organization.id).first(),
      "Projeto",
    );
    const linked = await context.db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND organization_id = ?2) +
        (SELECT COUNT(*) FROM project_files WHERE project_id = ?1 AND organization_id = ?2) +
        (SELECT COUNT(*) FROM budget_versions WHERE project_id = ?1 AND organization_id = ?2) +
        (SELECT COUNT(*) FROM site_diary_entries WHERE project_id = ?1 AND organization_id = ?2)
        AS total`,
    ).bind(projectId, context.organization.id).first<{ total: number }>();
    if ((linked?.total ?? 0) > 0) {
      throw new ApiError(409, "project_in_use", "Este projeto possui tarefas, arquivos, orçamentos ou diários vinculados.");
    }
    await context.db.batch([
      context.db.prepare("DELETE FROM projects WHERE id = ?1 AND organization_id = ?2")
        .bind(projectId, context.organization.id),
      auditStatement(context, "project.deleted", "project", projectId),
    ]);
    return new Response(null, { status: 204 });
  });
}
