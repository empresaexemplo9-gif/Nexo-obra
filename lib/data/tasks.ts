import "server-only";

import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { members, projects, tasks } from "@/db/schema";
import { DEFAULT_PAGE_SIZE, nowIso } from "@/lib/data/shared";
import { OPEN_TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/domain/enums";

/**
 * Consultas de tarefas.
 *
 * Mesma invariante: `organizationId` em toda cláusula `where`, joins incluídos.
 */

export type TaskRecord = typeof tasks.$inferSelect;

export type TaskListItem = TaskRecord & {
  projectName: string | null;
  projectCode: string | null;
  assigneeName: string | null;
};

export type TaskInput = {
  title: string;
  projectId?: string | null;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeMemberId?: string | null;
  startsAt?: string | null;
  dueAt?: string | null;
  estimatedMinutes?: number;
};

/**
 * Prioridade primeiro, vencimento depois — é a ordem da fila de execução, e é
 * a mesma regra que a tela mostra. Tarefa sem prazo vai para o fim.
 */
const QUEUE_ORDER = sql`
  case ${tasks.priority}
    when 'critical' then 0
    when 'high' then 1
    when 'normal' then 2
    else 3
  end,
  case when ${tasks.dueAt} is null then 1 else 0 end,
  ${tasks.dueAt} asc
`;

export async function listTasks(
  db: Database,
  organizationId: string,
  options: {
    projectId?: string;
    assigneeMemberId?: string;
    statuses?: readonly TaskStatus[];
    onlyOpen?: boolean;
    overdueOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: TaskListItem[]; total: number }> {
  const today = nowIso().slice(0, 10);

  const statuses = options.statuses ?? (options.onlyOpen ? OPEN_TASK_STATUSES : undefined);

  const where = and(
    eq(tasks.organizationId, organizationId),
    options.projectId ? eq(tasks.projectId, options.projectId) : undefined,
    options.assigneeMemberId ? eq(tasks.assigneeMemberId, options.assigneeMemberId) : undefined,
    statuses ? inArray(tasks.status, [...statuses]) : undefined,
    options.overdueOnly ? and(isNotNull(tasks.dueAt), lt(tasks.dueAt, today)) : undefined,
  );

  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: tasks.id,
        organizationId: tasks.organizationId,
        projectId: tasks.projectId,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        assigneeMemberId: tasks.assigneeMemberId,
        parentTaskId: tasks.parentTaskId,
        startsAt: tasks.startsAt,
        dueAt: tasks.dueAt,
        estimatedMinutes: tasks.estimatedMinutes,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        projectName: projects.name,
        projectCode: projects.code,
        assigneeName: members.name,
      })
      .from(tasks)
      .leftJoin(
        projects,
        and(eq(projects.id, tasks.projectId), eq(projects.organizationId, organizationId)),
      )
      .leftJoin(
        members,
        and(eq(members.id, tasks.assigneeMemberId), eq(members.organizationId, organizationId)),
      )
      .where(where)
      .orderBy(QUEUE_ORDER)
      .limit(options.limit ?? DEFAULT_PAGE_SIZE)
      .offset(options.offset ?? 0),
    db.select({ total: sql<number>`count(*)` }).from(tasks).where(where),
  ]);

  return { items, total: counted?.total ?? items.length };
}

export async function getTask(
  db: Database,
  organizationId: string,
  taskId: string,
): Promise<TaskRecord | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);

  return row ?? null;
}

/** Projeto e responsável precisam ser da mesma organização. */
export async function assertTaskRelations(
  db: Database,
  organizationId: string,
  relations: { projectId?: string | null; assigneeMemberId?: string | null },
): Promise<{ ok: true } | { ok: false; field: "projectId" | "assigneeMemberId" }> {
  if (relations.projectId) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, relations.projectId), eq(projects.organizationId, organizationId)))
      .limit(1);
    if (!row) return { ok: false, field: "projectId" };
  }

  if (relations.assigneeMemberId) {
    const [row] = await db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.id, relations.assigneeMemberId),
          eq(members.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return { ok: false, field: "assigneeMemberId" };
  }

  return { ok: true };
}

export async function createTask(
  db: Database,
  organizationId: string,
  input: TaskInput,
): Promise<TaskRecord> {
  const timestamp = nowIso();
  const status = input.status ?? "todo";

  const [row] = await db
    .insert(tasks)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      projectId: input.projectId ?? null,
      title: input.title,
      description: input.description ?? "",
      status,
      priority: input.priority ?? "normal",
      assigneeMemberId: input.assigneeMemberId ?? null,
      startsAt: input.startsAt ?? null,
      dueAt: input.dueAt ?? null,
      estimatedMinutes: input.estimatedMinutes ?? 0,
      // `completedAt` é derivado do status, nunca informado pelo cliente.
      completedAt: status === "done" ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  return row;
}

export async function updateTask(
  db: Database,
  organizationId: string,
  taskId: string,
  input: Partial<TaskInput>,
): Promise<TaskRecord | null> {
  const timestamp = nowIso();

  // Concluir carimba a data; reabrir limpa. Manter isso aqui impede que a
  // interface e a API discordem sobre o que "concluída" significa.
  const completion =
    input.status === undefined
      ? {}
      : input.status === "done"
        ? { completedAt: timestamp }
        : { completedAt: null };

  const [row] = await db
    .update(tasks)
    .set({ ...input, ...completion, updatedAt: timestamp })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .returning();

  return row ?? null;
}

export async function deleteTask(
  db: Database,
  organizationId: string,
  taskId: string,
): Promise<boolean> {
  const rows = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .returning({ id: tasks.id });

  return rows.length > 0;
}

export type TaskQueueCounts = {
  overdue: number;
  today: number;
  open: number;
  doneLast7Days: number;
};

/** Contagens da fila usadas na visão geral e na tela de tarefas. */
export async function countTaskQueue(
  db: Database,
  organizationId: string,
): Promise<TaskQueueCounts> {
  const today = nowIso().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const openStatuses = [...OPEN_TASK_STATUSES];

  const [[overdue], [dueToday], [open], [recentlyDone]] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)` })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          inArray(tasks.status, openStatuses),
          isNotNull(tasks.dueAt),
          lt(tasks.dueAt, today),
        ),
      ),
    db
      .select({ total: sql<number>`count(*)` })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          inArray(tasks.status, openStatuses),
          sql`substr(${tasks.dueAt}, 1, 10) = ${today}`,
        ),
      ),
    db
      .select({ total: sql<number>`count(*)` })
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), inArray(tasks.status, openStatuses))),
    db
      .select({ total: sql<number>`count(*)` })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          eq(tasks.status, "done"),
          isNotNull(tasks.completedAt),
          sql`${tasks.completedAt} >= ${sevenDaysAgo}`,
        ),
      ),
  ]);

  return {
    overdue: overdue?.total ?? 0,
    today: dueToday?.total ?? 0,
    open: open?.total ?? 0,
    doneLast7Days: recentlyDone?.total ?? 0,
  };
}

/** Tarefas sem responsável — uma das exceções que a visão geral destaca. */
export async function countUnassignedOpenTasks(
  db: Database,
  organizationId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        inArray(tasks.status, [...OPEN_TASK_STATUSES]),
        or(isNull(tasks.assigneeMemberId), eq(tasks.assigneeMemberId, "")),
      ),
    );

  return row?.total ?? 0;
}

