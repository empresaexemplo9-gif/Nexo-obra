import "server-only";

import { getDb } from "@/db";
import type { AuthenticatedContext } from "@/lib/auth/session";
import { can, type Capability, type Role } from "@/lib/auth/roles";
import { listClients } from "@/lib/data/clients";
import { listMemberWorkload } from "@/lib/data/members";
import { countProjectsByStatus, listProjects } from "@/lib/data/projects";
import { countTaskQueue, countUnassignedOpenTasks, listTasks } from "@/lib/data/tasks";
import type { ProjectKind, ProjectStatus, TaskPriority, TaskStatus } from "@/lib/domain/enums";

/**
 * Monta, no servidor, tudo que a interface precisa para a empresa ativa.
 *
 * Serve dois propósitos:
 *
 * 1. A interface recebe dados já recortados pela organização. O componente de
 *    cliente nunca escolhe de qual empresa carregar — ele recebe um retrato.
 * 2. Só atravessa a fronteira o que é serializável e o que o papel do usuário
 *    pode ver. Nada de instância de banco, token ou linha crua com campo extra.
 */

export type ProjectCard = {
  id: string;
  code: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  phase: string;
  progressPercent: number;
  clientId: string | null;
  clientName: string | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  startDate: string | null;
  targetDate: string | null;
  budgetCents: number;
  openTaskCount: number;
  overdueTaskCount: number;
  updatedAt: string;
};

export type TaskCard = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  estimatedMinutes: number;
};

export type ClientCard = {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  projectCount: number;
};

export type MemberOption = {
  id: string;
  name: string;
  role: string;
  weeklyCapacityMinutes: number;
  openTaskCount: number;
  loggedMinutes7d: number;
};

export type WorkspaceSnapshot = {
  user: { email: string; displayName: string };
  organization: { id: string; name: string; role: Role; memberId: string };
  organizations: { id: string; name: string }[];
  /** Capacidades já resolvidas, para a interface não reimplementar a matriz. */
  permissions: Record<Capability, boolean>;
  projects: ProjectCard[];
  tasks: TaskCard[];
  clients: ClientCard[];
  members: MemberOption[];
  counts: {
    projectsByStatus: Record<string, number>;
    tasks: { overdue: number; today: number; open: number; doneLast7Days: number };
    unassignedOpenTasks: number;
  };
};

const ALL_CAPABILITIES: Capability[] = [
  "organization:manage",
  "member:manage",
  "client:read",
  "client:write",
  "project:read",
  "project:write",
  "task:read",
  "task:write",
  "finance:read",
  "audit:read",
];

function resolvePermissions(role: Role): Record<Capability, boolean> {
  return Object.fromEntries(
    ALL_CAPABILITIES.map((capability) => [capability, can(role, capability)]),
  ) as Record<Capability, boolean>;
}

/** Limites generosos, mas finitos: nenhuma tela carrega a base inteira. */
const PROJECT_LIMIT = 100;
const TASK_LIMIT = 150;
const CLIENT_LIMIT = 150;

export async function loadWorkspace(auth: AuthenticatedContext): Promise<WorkspaceSnapshot> {
  const db = getDb();
  const organizationId = auth.active.organizationId;
  const role = auth.active.role;
  const permissions = resolvePermissions(role);

  // Um papel sem leitura não recebe lista vazia por acidente de consulta: a
  // consulta simplesmente não acontece.
  const [projectsResult, tasksResult, clientsResult, members, projectsByStatus, taskCounts, unassigned] =
    await Promise.all([
      permissions["project:read"]
        ? listProjects(db, organizationId, { limit: PROJECT_LIMIT })
        : Promise.resolve({ items: [], total: 0 }),
      permissions["task:read"]
        ? listTasks(db, organizationId, { limit: TASK_LIMIT })
        : Promise.resolve({ items: [], total: 0 }),
      permissions["client:read"]
        ? listClients(db, organizationId, { limit: CLIENT_LIMIT })
        : Promise.resolve({ items: [], total: 0 }),
      listMemberWorkload(db, organizationId),
      permissions["project:read"]
        ? countProjectsByStatus(db, organizationId)
        : Promise.resolve({}),
      permissions["task:read"]
        ? countTaskQueue(db, organizationId)
        : Promise.resolve({ overdue: 0, today: 0, open: 0, doneLast7Days: 0 }),
      permissions["task:read"]
        ? countUnassignedOpenTasks(db, organizationId)
        : Promise.resolve(0),
    ]);

  return {
    user: { email: auth.identity.email, displayName: auth.identity.displayName },
    organization: {
      id: organizationId,
      name: auth.active.organizationName,
      role,
      memberId: auth.active.memberId,
    },
    organizations: auth.memberships.map((membership) => ({
      id: membership.organizationId,
      name: membership.organizationName,
    })),
    permissions,
    projects: projectsResult.items.map((project) => ({
      id: project.id,
      code: project.code,
      name: project.name,
      kind: project.kind as ProjectKind,
      status: project.status as ProjectStatus,
      phase: project.phase,
      progressPercent: project.progressPercent,
      clientId: project.clientId,
      clientName: project.clientName,
      ownerMemberId: project.ownerMemberId,
      ownerName: project.ownerName,
      startDate: project.startDate,
      targetDate: project.targetDate,
      budgetCents: project.budgetCents,
      openTaskCount: Number(project.openTaskCount ?? 0),
      overdueTaskCount: Number(project.overdueTaskCount ?? 0),
      updatedAt: project.updatedAt,
    })),
    tasks: tasksResult.items.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status as TaskStatus,
      priority: task.priority as TaskPriority,
      projectId: task.projectId,
      projectName: task.projectName,
      projectCode: task.projectCode,
      assigneeMemberId: task.assigneeMemberId,
      assigneeName: task.assigneeName,
      dueAt: task.dueAt,
      estimatedMinutes: task.estimatedMinutes,
    })),
    clients: clientsResult.items.map((client) => ({
      id: client.id,
      name: client.name,
      document: client.document,
      email: client.email,
      phone: client.phone,
      projectCount: Number(client.projectCount ?? 0),
    })),
    members: members.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      weeklyCapacityMinutes: member.weeklyCapacityMinutes,
      openTaskCount: Number(member.openTaskCount ?? 0),
      loggedMinutes7d: Number(member.loggedMinutes7d ?? 0),
    })),
    counts: {
      projectsByStatus,
      tasks: taskCounts,
      unassignedOpenTasks: unassigned,
    },
  };
}
