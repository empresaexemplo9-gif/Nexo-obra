import { projectResponse, projectSelect, type ProjectRow } from "@/lib/server/projects-records";
import { z } from "zod";
import { validatePeriod } from "@/lib/server/task-planning";

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
    // Buscar pelo nome do cliente só para quem pode ver clientes: senão a lista de obras
    // que casam com "?q=" revelaria quem são os clientes a quem não tem acesso ao CRM.
    if (query) add(context.member.permissions.crm.view ? "(p.name LIKE ? OR p.code LIKE ? OR c.name LIKE ?)" : "(p.name LIKE ? OR p.code LIKE ?)", `%${query}%`);

    const result = await context.db
      .prepare(`${projectSelect} WHERE ${filters.join(" AND ")} ORDER BY p.updated_at DESC LIMIT 100`)
      .bind(...values)
      .all<ProjectRow>();
    const visibility = {
      includeClient: context.member.permissions.crm.view,
      includeBudget: context.member.permissions.budgets.view,
      includeFinance: context.member.permissions.finance.view,
    };
    return Response.json({ projects: result.results.map((project) => projectResponse(project, visibility)) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "projects", "edit");
    const parsed = createProjectSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    // Orçamento previsto é dado de orçamento: quem só edita obras não o define.
    if (data.budgetCents && !context.member.permissions.budgets.edit) {
      throw new ApiError(403, "budget_permission_required", "Seu perfil não pode definir o orçamento previsto da obra.");
    }
    validatePeriod(data.startDate, data.targetDate);
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
    return Response.json({
      project: projectResponse(project!, {
        includeClient: context.member.permissions.crm.view,
        includeBudget: context.member.permissions.budgets.view,
        includeFinance: context.member.permissions.finance.view,
      }),
    }, { status: 201 });
  });
}
