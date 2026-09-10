/**
 * Vocabulário do domínio.
 *
 * Os valores GRAVADOS são estáveis e em inglês; os rótulos exibidos são em
 * português. Separar os dois evita que uma mudança de texto na interface quebre
 * dados já persistidos — e evita acento e espaço dentro de chave de banco.
 */

export const PROJECT_KINDS = ["project", "work"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  project: "Projeto",
  work: "Obra",
};

export const PROJECT_STATUSES = ["active", "paused", "done", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Em andamento",
  paused: "Pausado",
  done: "Concluído",
  cancelled: "Cancelado",
};

export const TASK_STATUSES = ["todo", "doing", "blocked", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "A fazer",
  doing: "Em execução",
  blocked: "Bloqueada",
  review: "Em revisão",
  done: "Concluída",
};

/** Tarefa que ainda consome atenção — usado nas contagens de pendência. */
export const OPEN_TASK_STATUSES = ["todo", "doing", "blocked", "review"] as const;

export const TASK_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

/** Ordem de urgência, para ordenar a fila de execução. */
export const TASK_PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function labelFor<T extends string>(
  labels: Record<T, string>,
  value: string,
  fallback = value,
): string {
  return (labels as Record<string, string>)[value] ?? fallback;
}
