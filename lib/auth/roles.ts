/**
 * Papéis e permissões.
 *
 * A checagem acontece SEMPRE no servidor. A interface pode esconder um botão
 * por conveniência, mas esconder não é autorizar: toda rota que escreve chama
 * `assertCan` antes de tocar no banco.
 *
 * Este arquivo não importa `server-only` de propósito — a interface precisa ler
 * a matriz para decidir o que renderizar. Ele contém regras, nunca segredos.
 */

export const ROLES = ["owner", "admin", "manager", "member", "partner", "client"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gestor",
  member: "Integrante",
  partner: "Parceiro",
  client: "Cliente",
};

/**
 * Capacidades em vez de checagem por papel espalhada pelo código.
 * `organization:manage` cobre cobrança, integrações e segurança.
 */
export type Capability =
  | "organization:manage"
  | "member:manage"
  | "client:read"
  | "client:write"
  | "project:read"
  | "project:write"
  | "task:read"
  | "task:write"
  | "finance:read"
  | "audit:read";

const CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: [
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
  ],
  admin: [
    "member:manage",
    "client:read",
    "client:write",
    "project:read",
    "project:write",
    "task:read",
    "task:write",
    "finance:read",
    "audit:read",
  ],
  manager: [
    "client:read",
    "client:write",
    "project:read",
    "project:write",
    "task:read",
    "task:write",
    "finance:read",
  ],
  // Integrante executa: cria e atualiza tarefas, mas não abre projeto nem
  // cadastra cliente.
  member: ["client:read", "project:read", "task:read", "task:write"],
  // Parceiro e cliente são leitura. O recorte por projeto entra na Fase 3.
  partner: ["project:read", "task:read"],
  client: ["project:read"],
};

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

/** Erro de autorização com o status HTTP já decidido. */
export class ForbiddenError extends Error {
  readonly status = 403;

  constructor(capability: Capability, role: Role) {
    super(
      `O papel "${ROLE_LABELS[role]}" não tem permissão para esta ação (${capability}).`,
    );
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) throw new ForbiddenError(capability, role);
}
