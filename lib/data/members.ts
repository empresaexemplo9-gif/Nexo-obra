import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { members, tasks, timeEntries } from "@/db/schema";
import { OPEN_TASK_STATUSES } from "@/lib/domain/enums";

export type MemberRecord = typeof members.$inferSelect;

export type MemberWorkload = {
  id: string;
  name: string;
  email: string;
  role: string;
  weeklyCapacityMinutes: number;
  openTaskCount: number;
  /** Minutos apontados nos últimos 7 dias — realizado contra capacidade. */
  loggedMinutes7d: number;
};

export async function listMembers(
  db: Database,
  organizationId: string,
): Promise<MemberRecord[]> {
  return db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.active, true)))
    .orderBy(asc(members.name));
}

/** Carga da equipe: capacidade contratada contra o que está aberto e apontado. */
export async function listMemberWorkload(
  db: Database,
  organizationId: string,
): Promise<MemberWorkload[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const openStatuses = sql.join(
    OPEN_TASK_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );

  return db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      role: members.role,
      weeklyCapacityMinutes: members.weeklyCapacityMinutes,
      openTaskCount: sql<number>`(
        select count(*) from ${tasks}
        where ${tasks.assigneeMemberId} = ${members.id}
          and ${tasks.organizationId} = ${members.organizationId}
          and ${tasks.status} in (${openStatuses})
      )`,
      loggedMinutes7d: sql<number>`(
        select coalesce(sum(${timeEntries.minutes}), 0) from ${timeEntries}
        where ${timeEntries.memberId} = ${members.id}
          and ${timeEntries.organizationId} = ${members.organizationId}
          and ${timeEntries.startedAt} >= ${since}
      )`,
    })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.active, true)))
    .orderBy(asc(members.name));
}
