import { taskResponse, taskSelect, type TaskRow } from "@/lib/server/tasks-records";
import { z } from "zod";
import { validateTaskPlanning } from "@/lib/server/task-planning";

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

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(8000).default(""),
  status: z.enum(["todo", "in_progress", "blocked", "done"]).default("todo"),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  assigneeMemberId: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedMinutes: z.number().int().min(0).max(100000).default(0),
});

async function ownedRecord(db: D1Database, table: "projects" | "members" | "tasks", id: string, orgId: string) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?1 AND organization_id = ?2`)
    .bind(id, orgId).first<Record<string, string | null>>();
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "tasks", "view");
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const status = url.searchParams.get("status");
    const filters = ["t.organization_id = ?1"];
    const values: unknown[] = [context.organization.id];
    if (projectId) { values.push(projectId); filters.push(`t.project_id = ?${values.length}`); }
    if (status) { values.push(status); filters.push(`t.status = ?${values.length}`); }

    const result = await context.db.prepare(
      `${taskSelect} WHERE ${filters.join(" AND ")}
       ORDER BY CASE t.status WHEN 'blocked' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'todo' THEN 3 ELSE 4 END,
       t.due_at, t.updated_at DESC LIMIT 200`,
    ).bind(...values).all<TaskRow>();
    return Response.json({ tasks: result.results.map(taskResponse) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "tasks", "edit");
    const parsed = createTaskSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    if (!await ownedRecord(context.db, "projects", data.projectId, context.organization.id)) {
      throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
    }
    const assignee = data.assigneeMemberId
      ? await ownedRecord(context.db, "members", data.assigneeMemberId, context.organization.id)
      : null;
    if (data.assigneeMemberId && !assignee) {
      throw new ApiError(400, "invalid_assignee", "O responsável não pertence à empresa atual.");
    }
    if (data.parentTaskId && !await ownedRecord(context.db, "tasks", data.parentTaskId, context.organization.id)) {
      throw new ApiError(400, "invalid_parent_task", "A tarefa principal não pertence à empresa atual.");
    }

    const taskId = crypto.randomUUID();
    await validateTaskPlanning(context.db, context.organization.id, { id: taskId, ...data });
    const completedAt = data.status === "done" ? new Date().toISOString() : null;
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO tasks (
          id, organization_id, project_id, assignee_user_id, assignee_member_id,
          title, description, status, priority, parent_task_id, starts_at,
          due_at, estimated_minutes, completed_at, created_at, updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
      ).bind(
        taskId,
        context.organization.id,
        data.projectId,
        assignee?.external_user_id ?? null,
        data.assigneeMemberId ?? null,
        data.title,
        data.description,
        data.status,
        data.priority,
        data.parentTaskId ?? null,
        data.startsAt ?? null,
        data.dueAt ?? null,
        data.estimatedMinutes,
        completedAt,
      ),
      auditStatement(context, "task.created", "task", taskId, { projectId: data.projectId }),
    ]);

    const task = await context.db.prepare(`${taskSelect} WHERE t.id = ?1 AND t.organization_id = ?2`)
      .bind(taskId, context.organization.id).first<TaskRow>();
    return Response.json({ task: taskResponse(task!) }, { status: 201 });
  });
}
