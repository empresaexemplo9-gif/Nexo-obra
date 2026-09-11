export const permissionModules = [
  "overview", "projects", "budgets", "schedule", "diary", "portal", "crm", "finance", "team", "tasks", "files",
] as const;

export type PermissionModule = typeof permissionModules[number];
export type PermissionAction = "view" | "edit";
export type PermissionGrant = { view: boolean; edit: boolean };
export type PermissionSet = Record<PermissionModule, PermissionGrant>;

export const permissionModuleLabels: Record<PermissionModule, string> = {
  overview: "Visão geral",
  projects: "Projetos e obras",
  budgets: "Orçamentos",
  schedule: "Cronograma",
  diary: "Diário de obra",
  portal: "Portal do cliente",
  crm: "Clientes e CRM",
  finance: "Financeiro",
  team: "Equipe e acessos",
  tasks: "Tarefas",
  files: "Arquivos",
};

// Perfil da plataforma, fora da matriz das empresas: leitura e edição total em todos os módulos.
export const PLATFORM_SUPERADMIN_ROLE = "superadmin";

export const accessProfileLabels: Record<string, string> = {
  superadmin: "Superadministrador da plataforma",
  owner: "Contratante · proprietário",
  admin: "Administrador",
  manager: "Gestor",
  member: "Colaborador",
  partner: "Parceiro",
  service_provider: "Prestador de serviço",
  finance: "Financeiro",
  accounting: "Contabilidade",
};

const none = (): PermissionSet => Object.fromEntries(
  permissionModules.map((module) => [module, { view: false, edit: false }]),
) as PermissionSet;

const full = (): PermissionSet => Object.fromEntries(
  permissionModules.map((module) => [module, { view: true, edit: true }]),
) as PermissionSet;

export function permissionsForRole(role: string): PermissionSet {
  if (role === PLATFORM_SUPERADMIN_ROLE || role === "owner" || role === "admin") return full();
  const permissions = none();
  const set = (area: PermissionModule, view: boolean, edit = false) => {
    permissions[area] = { view: view || edit, edit };
  };
  if (role === "manager") {
    for (const area of ["overview", "projects", "budgets", "schedule", "crm", "tasks", "files"] as PermissionModule[]) set(area, true, true);
    set("finance", true); set("team", true);
  } else if (role === "member") {
    for (const area of ["overview", "projects", "schedule", "files"] as PermissionModule[]) set(area, true);
    set("tasks", true, true);
  } else if (role === "partner") {
    for (const area of ["overview", "projects", "schedule", "tasks", "files"] as PermissionModule[]) set(area, true);
  } else if (role === "service_provider") {
    for (const area of ["overview", "projects", "schedule"] as PermissionModule[]) set(area, true);
    set("tasks", true, true); set("files", true, true);
  } else if (role === "finance") {
    for (const area of ["overview", "budgets", "finance", "files"] as PermissionModule[]) set(area, true, true);
    set("projects", true);
  } else if (role === "accounting") {
    for (const area of ["overview", "budgets", "finance", "files"] as PermissionModule[]) set(area, true);
  }
  return permissions;
}

export function normalizePermissions(value: unknown, role: string): PermissionSet {
  if (role === PLATFORM_SUPERADMIN_ROLE || role === "owner") return full();
  const defaults = permissionsForRole(role);
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const input = value as Record<string, unknown>;
  const normalized = none();
  for (const area of permissionModules) {
    const grant = input[area];
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) {
      // New modules must not expand an already customized secondary account's access.
      normalized[area] = ["diary", "portal"].includes(area) && Object.keys(input).length > 0 ? { view: false, edit: false } : defaults[area];
      continue;
    }
    const candidate = grant as Record<string, unknown>;
    const edit = candidate.edit === true;
    normalized[area] = { view: candidate.view === true || edit, edit };
  }
  return normalized;
}

// Ninguém libera mais do que tem. Sem isso, um administrador sem acesso ao Financeiro
// poderia convidar uma conta com Financeiro liberado e entrar por ela.
export function permissionsBeyond(granted: PermissionSet, granter: PermissionSet): PermissionModule[] {
  return permissionModules.filter((module) =>
    (granted[module].view && !granter[module].view) || (granted[module].edit && !granter[module].edit));
}

export function parseStoredPermissions(value: string | null | undefined, role: string) {
  if (!value) return permissionsForRole(role);
  try { return normalizePermissions(JSON.parse(value), role); }
  catch { return permissionsForRole(role); }
}
