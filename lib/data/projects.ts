import "server-only";

import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { clients, members, projects, tasks } from "@/db/schema";
import { DEFAULT_PAGE_SIZE, nowIso } from "@/lib/data/shared";
import { OPEN_TASK_STATUSES, type ProjectKind, type ProjectStatus } from "@/lib/domain/enums";

/**
 * Consultas de projetos e obras.
 *
 * Mesma invariante de `clients.ts`: `organizationId` em toda cláusula `where`.
 * O join com clientes e responsáveis também é filtrado pela organização — um
 * join sem esse filtro reintroduziria o vazamento pela porta dos fundos.
 */

export type ProjectRecord = typeof projects.$inferSelect;

export type ProjectListItem = ProjectRecord & {
  clientName: string | null;
  ownerName: string | null;
  openTaskCount: number;
  overdueTaskCount: number;
};

export type ProjectInput = {
  code: string;
  name: string;
  kind: ProjectKind;
  clientId?: string | null;
  status?: ProjectStatus;
  phase?: string;
  progressPercent?: number;
  ownerMemberId?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  budgetCents?: number;
  externalFinancialCostCenterId?: string | null;
};

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Lista de status abertos como SQL.
 *
 * Um array interpolado em `sql``` vira UM parâmetro ligado, não uma lista,
 * então `in ${ARRAY}` compararia com o array inteiro e nunca casaria. Aqui os
 * valores viram parâmetros separados.
 */
const OPEN_TASK_STATUS_SQL = sql.join(
  OPEN_TASK_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

export async function listProjects(
  db: Database,
  organizationId: string,
  options: {
    search?: string;
    kind?: ProjectKind;
    status?: ProjectStatus;
    clientId?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: ProjectListItem[]; total: number }> {
  const search = options.search?.trim();
  const pattern = search ? `%${escapeLike(search)}%` : null;
  const today = nowIso().slice(0, 10);

  const where = and(
    eq(projects.organizationId, organizationId),
    options.kind ? eq(projects.kind, options.kind) : undefined,
    options.status ? eq(projects.status, options.status) : undefined,
    options.clientId ? eq(projects.clientId, options.clientId) : undefined,
    pattern
      ? or(like(projects.name, pattern), like(projects.code, pattern), like(clients.name, pattern))
      : undefined,
  );

  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: projects.id,
        organizationId: projects.organizationId,
        clientId: projects.clientId,
        code: projects.code,
        name: projects.name,
        kind: projects.kind,
        status: projects.status,
        phase: projects.phase,
        progressPercent: projects.progressPercent,
        ownerMemberId: projects.ownerMemberId,
        startDate: projects.startDate,
        targetDate: projects.targetDate,
        budgetCents: projects.budgetCents,
        externalFinancialCostCenterId: projects.externalFinancialCostCenterId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        clientName: clients.name,
        ownerName: members.name,
        openTaskCount: sql<number>`(
          select count(*) from ${tasks}
          where ${tasks.projectId} = ${projects.id}
            and ${tasks.organizationId} = ${projects.organizationId}
            and ${tasks.status} in (${OPEN_TASK_STATUS_SQL})
        )`,
        overdueTaskCount: sql<number>`(
          select count(*) from ${tasks}
          where ${tasks.projectId} = ${projects.id}
            and ${tasks.organizationId} = ${projects.organizationId}
            and ${tasks.status} in (${OPEN_TASK_STATUS_SQL})
            and ${tasks.dueAt} is not null
            and ${tasks.dueAt} < ${today}
        )`,
      })
      .from(projects)
      // O join carrega o filtro de organização junto: sem ele, um clientId de
      // outra empresa poderia emprestar o nome para esta listagem.
      .leftJoin(
        clients,
        and(eq(clients.id, projects.clientId), eq(clients.organizationId, organizationId)),
      )
      .leftJoin(
        members,
        and(eq(members.id, projects.ownerMemberId), eq(members.organizationId, organizationId)),
      )
      .where(where)
      .orderBy(desc(projects.updatedAt))
      .limit(options.limit ?? DEFAULT_PAGE_SIZE)
      .offset(options.offset ?? 0),
    db
      .select({ total: sql<number>`count(*)` })
      .from(projects)
      .leftJoin(
        clients,
        and(eq(clients.id, projects.clientId), eq(clients.organizationId, organizationId)),
      )
      .where(where),
  ]);

  return { items, total: counted?.total ?? items.length };
}

export async function getProject(
  db: Database,
  organizationId: string,
  projectId: string,
): Promise<ProjectRecord | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);

  return row ?? null;
}

/**
 * Confere que as chaves estrangeiras informadas pertencem à MESMA organização.
 *
 * Sem esta checagem um `clientId` válido de outra empresa seria aceito pelo
 * banco (a FK só exige que a linha exista) e criaria um vínculo entre empresas.
 */
export async function assertRelationsBelongToOrganization(
  db: Database,
  organizationId: string,
  relations: { clientId?: string | null; ownerMemberId?: string | null },
): Promise<{ ok: true } | { ok: false; field: "clientId" | "ownerMemberId" }> {
  if (relations.clientId) {
    const [row] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, relations.clientId), eq(clients.organizationId, organizationId)))
      .limit(1);
    if (!row) return { ok: false, field: "clientId" };
  }

  if (relations.ownerMemberId) {
    const [row] = await db
      .select({ id: members.id })
      .from(members)
      .where(
        and(eq(members.id, relations.ownerMemberId), eq(members.organizationId, organizationId)),
      )
      .limit(1);
    if (!row) return { ok: false, field: "ownerMemberId" };
  }

  return { ok: true };
}

export async function isCodeTaken(
  db: Database,
  organizationId: string,
  code: string,
  exceptProjectId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.code, code)))
    .limit(2);

  return rows.some((row) => row.id !== exceptProjectId);
}

export async function createProject(
  db: Database,
  organizationId: string,
  input: ProjectInput,
): Promise<ProjectRecord> {
  const timestamp = nowIso();
  const [row] = await db
    .insert(projects)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      clientId: input.clientId ?? null,
      code: input.code,
      name: input.name,
      kind: input.kind,
      status: input.status ?? "active",
      phase: input.phase ?? "briefing",
      progressPercent: input.progressPercent ?? 0,
      ownerMemberId: input.ownerMemberId ?? null,
      startDate: input.startDate ?? null,
      targetDate: input.targetDate ?? null,
      budgetCents: input.budgetCents ?? 0,
      externalFinancialCostCenterId: input.externalFinancialCostCenterId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  return row;
}

export async function updateProject(
  db: Database,
  organizationId: string,
  projectId: string,
  input: Partial<ProjectInput>,
): Promise<ProjectRecord | null> {
  const [row] = await db
    .update(projects)
    .set({ ...input, updatedAt: nowIso() })
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .returning();

  return row ?? null;
}

/**
 * Remove o projeto e suas tarefas na mesma organização.
 *
 * As tarefas saem primeiro porque referenciam o projeto. Só isso é apagado em
 * cascata: orçamento, arquivo e diário são histórico e exigem decisão explícita.
 */
export async function deleteProject(
  db: Database,
  organizationId: string,
  projectId: string,
): Promise<boolean> {
  const existing = await getProject(db, organizationId, projectId);
  if (!existing) return false;

  await db
    .delete(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.organizationId, organizationId)));
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)));

  return true;
}

/** Contagens por situação para os indicadores da tela de projetos. */
export async function countProjectsByStatus(
  db: Database,
  organizationId: string,
  kinds: readonly ProjectKind[] = ["project", "work"],
): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: projects.status, total: sql<number>`count(*)` })
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), inArray(projects.kind, [...kinds])))
    .groupBy(projects.status);

  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}
