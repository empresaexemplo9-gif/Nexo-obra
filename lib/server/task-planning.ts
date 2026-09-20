import { ApiError } from "./backend";

export function validatePeriod(startsAt: string | null | undefined, dueAt: string | null | undefined) {
  if (startsAt && dueAt && new Date(startsAt).getTime() > new Date(dueAt).getTime()) {
    throw new ApiError(400, "invalid_period", "O prazo final não pode ser anterior ao início.");
  }
}

export async function validateTaskPlanning(db: D1Database, organizationId: string, task: {
  id: string; projectId: string; parentTaskId?: string | null; startsAt?: string | null; dueAt?: string | null;
}) {
  validatePeriod(task.startsAt, task.dueAt);
  if (task.parentTaskId) {
    const parent = await db.prepare("SELECT id, project_id FROM tasks WHERE id = ?1 AND organization_id = ?2")
      .bind(task.parentTaskId, organizationId).first<{ id: string; project_id: string }>();
    if (!parent || parent.project_id !== task.projectId) throw new ApiError(400, "invalid_parent_task", "A dependência deve ser uma tarefa do mesmo projeto.");
    const cycle = await db.prepare(`WITH RECURSIVE ancestors(id, parent_task_id) AS (
      SELECT id, parent_task_id FROM tasks WHERE id = ?1 AND organization_id = ?2
      UNION
      SELECT t.id, t.parent_task_id FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id WHERE t.organization_id = ?2
    ) SELECT id FROM ancestors WHERE id = ?3 LIMIT 1`).bind(task.parentTaskId, organizationId, task.id).first();
    if (cycle) throw new ApiError(400, "dependency_cycle", "Esta dependência criaria um ciclo no cronograma.");
  }
  const foreignChild = await db.prepare("SELECT id FROM tasks WHERE parent_task_id = ?1 AND organization_id = ?2 AND project_id <> ?3 LIMIT 1")
    .bind(task.id, organizationId, task.projectId).first();
  if (foreignChild) throw new ApiError(400, "dependent_tasks", "Remova as dependências antes de mover a tarefa para outro projeto.");
}
