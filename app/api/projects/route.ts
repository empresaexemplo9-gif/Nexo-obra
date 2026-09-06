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

const createProjectSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(2).max(24),
  name: z.string().trim().min(3).max(160),
  kind: z.enum(["project", "work"]),
  status: z.enum(["active", "on_hold", "completed", "archived"]).default("active"),
  phase: z.string().trim().min(2).max(80).default("briefing"),
  progressPercent: z.number().int().min(0).max(100).default(0),
  ownerMemberId: z.string().uuid().nullable().optional(),
  startDate: z.string().date().nullable().optional(),
  targetDate: z.string().date().nullable().optional(),
  budgetCents: z.number().int().nonnegative().default(0),
});

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

export function projectResponse(row: ProjectRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
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
    budgetCents: row.budget_cents,
    externalFinancialCostCenterId: row.external_financial_cost_center_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function verifyRelation(
  db: D1Database,
  table: "clients" | "members",
  id: string | null | undefined,
  organizationId: string,
  label: string,
) {
  if (!id) return;
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?1 AND organization_id = ?2`)
    .bind(id, organizationId).first();
  if (!row) throw new ApiError(400, "invalid_relation", `${label} não pertence à empresa atual.`);
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "projects", "view");
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const status = url.searchParams.get("status");
    const query = url.searchParams.get("q")?.trim();
    const filters = ["p.organization_id = ?1"];
    const values: unknown[] = [context.organization.id];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      filters.push(sql.replaceAll("?", `?${values.length}`));
    };
    if (kind === "project" || kind === "work") add("p.kind = ?", kind);
    if (status) add("p.status = ?", status);
    if (query) add("(p.name LIKE ? OR p.code LIKE ? OR c.name LIKE ?)", `%${query}%`);

    const result = await context.db
      .prepare(`${projectSelect} WHERE ${filters.join(" AND ")} ORDER BY p.updated_at DESC LIMIT 100`)
      .bind(...values)
      .all<ProjectRow>();
    return Response.json({ projects: result.results.map(projectResponse) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "projects", "edit");
    const parsed = createProjectSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    await verifyRelation(context.db, "clients", data.clientId, context.organization.id, "O cliente");
    await verifyRelation(context.db, "members", data.ownerMemberId, context.organization.id, "O responsável");

    const projectId = crypto.randomUUID();
    try {
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
            ?6, ?6, ?7, ?8, ?8, ?9, ?9,
            ?10, ?11, ?11, ?12, ?12,
            ?13, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )`,
        ).bind(
          projectId,
          context.organization.id,
          data.clientId ?? null,
          data.code,
          data.name,
          data.kind,
          data.status,
          data.phase,
          data.progressPercent,
          data.ownerMemberId ?? null,
          data.startDate ?? null,
          data.targetDate ?? null,
          data.budgetCents,
        ),
        auditStatement(context, "project.created", "project", projectId, { code: data.code }),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) {
        throw new ApiError(409, "project_code_conflict", "Este código de projeto já está em uso.");
      }
      throw error;
    }

    const project = await context.db
      .prepare(`${projectSelect} WHERE p.id = ?1 AND p.organization_id = ?2`)
      .bind(projectId, context.organization.id)
      .first<ProjectRow>();
    return Response.json({ project: projectResponse(project!) }, { status: 201 });
  });
}
