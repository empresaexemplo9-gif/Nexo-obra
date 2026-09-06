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
import { taskResponse, taskSelect, type TaskRow } from "../route";

export const dynamic = "force-dynamic";

const updateTaskSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(8000).optional(),
  status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  assigneeMemberId: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedMinutes: z.number().int().min(0).max(100000).optional(),
}).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

type RouteContext = { params: Promise<{ taskId: string }> };

async function ownedRecord(db: D1Database, table: "projects" | "members" | "tasks", id: string, orgId: string) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?1 AND organization_id = ?2`)
    .bind(id, orgId).first<Record<string, string | null>>();
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "tasks", "view");
    const { taskId } = await route.params;
    const task = ensureFound(
      await context.db.prepare(`${taskSelect} WHERE t.id = ?1 AND t.organization_id = ?2`)
        .bind(taskId, context.organization.id).first<TaskRow>(),
      "Tarefa",
    );
    return Response.json({ task: taskResponse(task) });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "tasks", "edit");
    const { taskId } = await route.params;
    ensureFound(await ownedRecord(context.db, "tasks", taskId, context.organization.id), "Tarefa");
    const parsed = updateTaskSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    if (data.projectId && !await ownedRecord(context.db, "projects", data.projectId, context.organization.id)) {
      throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
    }
    const assignee = data.assigneeMemberId
      ? await ownedRecord(context.db, "members", data.assigneeMemberId, context.organization.id)
      : null;
    if (data.assigneeMemberId && !assignee) {
      throw new ApiError(400, "invalid_assignee", "O responsável não pertence à empresa atual.");
    }
    if (data.parentTaskId === taskId) {
      throw new ApiError(400, "invalid_parent_task", "Uma tarefa não pode depender dela mesma.");
    }
    if (data.parentTaskId && !await ownedRecord(context.db, "tasks", data.parentTaskId, context.organization.id)) {
      throw new ApiError(400, "invalid_parent_task", "A tarefa principal não pertence à empresa atual.");
    }

    const columns: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      columns.push(`${column} = ?${values.length + 1}`);
      values.push(value);
    };
    if (data.projectId !== undefined) add("project_id", data.projectId);
    if (data.title !== undefined) add("title", data.title);
    if (data.description !== undefined) add("description", data.description);
    if (data.status !== undefined) {
      add("status", data.status);
      add("completed_at", data.status === "done" ? new Date().toISOString() : null);
    }
    if (data.priority !== undefined) add("priority", data.priority);
    if (data.assigneeMemberId !== undefined) {
      add("assignee_member_id", data.assigneeMemberId);
      add("assignee_user_id", assignee?.external_user_id ?? null);
    }
    if (data.parentTaskId !== undefined) add("parent_task_id", data.parentTaskId);
    if (data.startsAt !== undefined) add("starts_at", data.startsAt);
    if (data.dueAt !== undefined) add("due_at", data.dueAt);
    if (data.estimatedMinutes !== undefined) add("estimated_minutes", data.estimatedMinutes);
    columns.push("updated_at = CURRENT_TIMESTAMP");
    const idPosition = values.length + 1;
    const orgPosition = values.length + 2;

    await context.db.batch([
      context.db.prepare(`UPDATE tasks SET ${columns.join(", ")} WHERE id = ?${idPosition} AND organization_id = ?${orgPosition}`)
        .bind(...values, taskId, context.organization.id),
      auditStatement(context, "task.updated", "task", taskId, { fields: Object.keys(data) }),
    ]);

    const task = ensureFound(
      await context.db.prepare(`${taskSelect} WHERE t.id = ?1 AND t.organization_id = ?2`)
        .bind(taskId, context.organization.id).first<TaskRow>(),
      "Tarefa",
    );
    return Response.json({ task: taskResponse(task) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "tasks", "edit");
    const { taskId } = await route.params;
    ensureFound(await ownedRecord(context.db, "tasks", taskId, context.organization.id), "Tarefa");
    const children = await context.db.prepare(
      "SELECT COUNT(*) AS total FROM tasks WHERE parent_task_id = ?1 AND organization_id = ?2",
    ).bind(taskId, context.organization.id).first<{ total: number }>();
    if ((children?.total ?? 0) > 0) {
      throw new ApiError(409, "task_in_use", "Remova o vínculo das subtarefas antes de excluir esta tarefa.");
    }
    await context.db.batch([
      context.db.prepare("DELETE FROM tasks WHERE id = ?1 AND organization_id = ?2")
        .bind(taskId, context.organization.id),
      auditStatement(context, "task.deleted", "task", taskId),
    ]);
    return new Response(null, { status: 204 });
  });
}
