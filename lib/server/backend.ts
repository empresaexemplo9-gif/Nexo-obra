import { getDatabase } from "@/db";
import { ApiError } from "@/lib/server/api-error";
import { assertPlatformAccess } from "@/lib/server/platform-access";
import {
  parseStoredPermissions,
  permissionsForRole,
  PLATFORM_SUPERADMIN_ROLE,
  type PermissionAction,
  type PermissionModule,
  type PermissionSet,
} from "@/lib/permissions";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { MAINTENANCE_ORGANIZATION_ID, maintenanceOrganizationStatement, readMaintenanceIdentity } from "@/lib/server/maintenance";
import { readSuperAdminIdentity, SUPERADMIN_DISPLAY_NAME, SUPERADMIN_USER_ID } from "@/lib/server/superadmin";

export { ApiError };

export type OrganizationContext = {
  db: D1Database;
  user: { id: string; email: string; displayName: string };
  member: { id: string; externalUserId: string; role: string; permissions: PermissionSet };
  organization: { id: string; name: string; slug: string; timezone: string };
  termsAccepted: boolean;
};

type MembershipRow = {
  member_id: string;
  external_user_id: string;
  member_name: string;
  email: string;
  role: string;
  permissions_json: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  timezone: string;
};

export type AuthenticatedIdentity = { id: string; email: string; displayName: string; scope?: "maintenance" | "superadmin" };
const ORGANIZATION_COOKIE = "__Host-nexo-organization";

type OrganizationRow = { id: string; name: string; slug: string; timezone: string };

export async function requireOrganizationContext(
  request: Request,
  allowedRoles?: readonly string[],
  options: { allowUnacceptedTerms?: boolean } = {},
): Promise<OrganizationContext> {
  const identity = await authenticatedIdentity(request);
  const db = getDatabase();
  // O superadministrador opera qualquer empresa com poder total: sem papel exigido,
  // sem bloqueio de acesso e sem aceite de termos, que pertencem ao contratante.
  if (identity.scope === "superadmin") return superAdminContext(db, identity, request);
  const memberships = await findMemberships(db, identity);
  if (memberships.length === 0) {
    throw new ApiError(403, "membership_required", "Sua conta ainda não pertence a uma empresa na H.OIKOS.");
  }
  const requestedOrganizationId = selectedOrganizationId(request);
  const membership = memberships.find((item) => item.organization_id === requestedOrganizationId) ?? memberships[0];
  await assertPlatformAccess(membership.organization_id, identity.email, identity.id);
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new ApiError(403, "insufficient_permission", "Seu perfil não permite executar esta ação.");
  }
  const context = await contextFromMembership(db, identity, membership);
  if (!options.allowUnacceptedTerms && !context.termsAccepted) {
    throw new ApiError(403, "terms_acceptance_required", "Aceite os Termos de Uso para continuar.");
  }
  return context;
}

export async function authenticatedIdentity(request: Request): Promise<AuthenticatedIdentity> {
  const superAdmin = await readSuperAdminIdentity(request);
  if (superAdmin) return { id: superAdmin.id, email: superAdmin.email, displayName: superAdmin.displayName, scope: "superadmin" };
  const userId = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  if (!userId || !email) {
    const maintenance = await readMaintenanceIdentity(request);
    if (maintenance) return maintenance;
    throw new ApiError(401, "sign_in_required", "Entre com sua conta para acessar os dados da empresa.");
  }
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const displayName = encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
    ? safeDecode(encodedName) ?? email : email;
  return { id: userId, email, displayName };
}

export async function listOrganizationMemberships(request: Request) {
  const identity = await authenticatedIdentity(request);
  const db = getDatabase();
  if (identity.scope === "superadmin") {
    const result = await db.prepare(
      "SELECT id, name, slug, timezone FROM organizations ORDER BY name",
    ).all<OrganizationRow>();
    return result.results.map((organization) => ({
      member_id: "",
      external_user_id: SUPERADMIN_USER_ID,
      member_name: SUPERADMIN_DISPLAY_NAME,
      email: identity.email,
      role: PLATFORM_SUPERADMIN_ROLE,
      permissions_json: "",
      organization_id: organization.id,
      organization_name: organization.name,
      organization_slug: organization.slug,
      timezone: organization.timezone,
    })) satisfies MembershipRow[];
  }
  return findMemberships(db, identity);
}

// A empresa aberta pelo superadministrador vem do mesmo cookie de seleção. O ambiente de
// manutenção só é aberto quando escolhido de propósito, e nunca é o destino padrão.
async function superAdminOrganization(db: D1Database, request: Request) {
  const requested = selectedOrganizationId(request);
  const columns = "SELECT id, name, slug, timezone FROM organizations";
  const find = (id: string) => db.prepare(`${columns} WHERE id = ?1`).bind(id).first<OrganizationRow>();
  if (requested === MAINTENANCE_ORGANIZATION_ID) {
    const existing = await find(requested);
    if (existing) return existing;
    await maintenanceOrganizationStatement(db).run();
    return ensureFound(await find(requested), "Ambiente de manutenção");
  }
  const selected = requested ? await find(requested) : null;
  if (selected) return selected;
  const latest = await db.prepare(`${columns} WHERE id != ?1 ORDER BY created_at DESC LIMIT 1`)
    .bind(MAINTENANCE_ORGANIZATION_ID).first<OrganizationRow>();
  if (!latest) throw new ApiError(404, "no_organization", "Nenhuma empresa cadastrada na plataforma.");
  return latest;
}

// O superadministrador recebe um membro reservado em cada empresa que abre. Isso mantém
// a integridade das escritas que apontam para members e registra quem operou.
async function superAdminMember(db: D1Database, organizationId: string, email: string) {
  const permissions = JSON.stringify(permissionsForRole(PLATFORM_SUPERADMIN_ROLE));
  const existing = await db.prepare(
    "SELECT id, role, active FROM members WHERE organization_id = ?1 AND external_user_id = ?2",
  ).bind(organizationId, SUPERADMIN_USER_ID).first<{ id: string; role: string; active: number }>();
  const actor = await db.prepare("SELECT id FROM users WHERE id = ?1 OR lower(email) = lower(?2) LIMIT 1")
    .bind(SUPERADMIN_USER_ID, email).first<{ id: string }>();
  const actorUserId = actor?.id ?? SUPERADMIN_USER_ID;
  if (existing && existing.role === PLATFORM_SUPERADMIN_ROLE && existing.active === 1) {
    return { id: existing.id, actorUserId };
  }
  const memberId = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
      .bind(actorUserId, email, SUPERADMIN_DISPLAY_NAME, now),
    db.prepare(
      `INSERT INTO members (
        id, organization_id, external_user_id, name, email, role,
        permissions_json, weekly_capacity_minutes, active, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id, external_user_id) DO UPDATE SET
        name = excluded.name, email = excluded.email, role = excluded.role,
        permissions_json = excluded.permissions_json, active = 1, updated_at = CURRENT_TIMESTAMP`,
    ).bind(memberId, organizationId, SUPERADMIN_USER_ID, SUPERADMIN_DISPLAY_NAME, email, PLATFORM_SUPERADMIN_ROLE, permissions),
    db.prepare(
      `INSERT INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?1, ?2, ?3, 'platform.superadmin_entered', 'organization', ?2, '{}', ?4)`,
    ).bind(crypto.randomUUID(), organizationId, email, now),
  ]);
  return { id: memberId, actorUserId };
}

async function superAdminContext(
  db: D1Database,
  identity: AuthenticatedIdentity,
  request: Request,
): Promise<OrganizationContext> {
  const organization = await superAdminOrganization(db, request);
  const member = await superAdminMember(db, organization.id, identity.email);
  return {
    db,
    user: { id: identity.id, email: identity.email, displayName: identity.displayName },
    member: {
      id: member.id,
      externalUserId: member.actorUserId,
      role: PLATFORM_SUPERADMIN_ROLE,
      permissions: permissionsForRole(PLATFORM_SUPERADMIN_ROLE),
    },
    organization,
    termsAccepted: true,
  };
}

async function findMemberships(db: D1Database, identity: AuthenticatedIdentity) {
  const maintenanceFilter = identity.scope === "maintenance" ? " AND m.organization_id = ?3" : "";
  const result = await db.prepare(
    `SELECT m.id AS member_id, m.external_user_id, m.name AS member_name, m.email,
      m.role, m.permissions_json, o.id AS organization_id, o.name AS organization_name,
      o.slug AS organization_slug, o.timezone
     FROM members m INNER JOIN organizations o ON o.id = m.organization_id
     WHERE m.active = 1 AND m.role != '${PLATFORM_SUPERADMIN_ROLE}'
       AND (m.external_user_id = ?1 OR lower(m.email) = lower(?2))${maintenanceFilter}
     ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3 WHEN 'member' THEN 4 ELSE 5 END, o.name`,
  ).bind(...(identity.scope === "maintenance" ? [identity.id, identity.email, MAINTENANCE_ORGANIZATION_ID] : [identity.id, identity.email])).all<MembershipRow>();
  return result.results;
}

async function contextFromMembership(db: D1Database, identity: AuthenticatedIdentity, membership: MembershipRow): Promise<OrganizationContext> {
  const acceptedTerms = await db.prepare(
    `SELECT id FROM terms_acceptances WHERE organization_id = ?1 AND terms_version = ?2
     AND (external_user_id = ?3 OR lower(email) = lower(?4)) LIMIT 1`,
  ).bind(membership.organization_id, CURRENT_TERMS_VERSION, identity.id, identity.email).first();
  return {
    db,
    user: { id: identity.id, email: identity.email, displayName: membership.member_name || identity.displayName },
    member: {
      id: membership.member_id,
      externalUserId: membership.external_user_id,
      role: membership.role,
      permissions: parseStoredPermissions(membership.permissions_json, membership.role),
    },
    organization: {
      id: membership.organization_id,
      name: membership.organization_name,
      slug: membership.organization_slug,
      timezone: membership.timezone,
    },
    termsAccepted: Boolean(acceptedTerms),
  };
}

export function isMaintenanceOrganization(context: OrganizationContext) {
  return context.organization.id === MAINTENANCE_ORGANIZATION_ID;
}

export function isPlatformSuperAdmin(context: OrganizationContext) {
  return context.member.role === PLATFORM_SUPERADMIN_ROLE;
}

export function requireModulePermission(context: OrganizationContext, module: PermissionModule, action: PermissionAction) {
  if (!isPlatformSuperAdmin(context) && !context.member.permissions[module][action]) {
    throw new ApiError(403, "module_permission_denied", "Seu acesso não permite esta operação.");
  }
}

export function canManageOrganizationAccess(context: OrganizationContext) {
  return isPlatformSuperAdmin(context) || context.member.role === "owner"
    || (context.member.role === "admin" && context.member.permissions.team.edit);
}

function selectedOrganizationId(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === ORGANIZATION_COOKIE) {
      try { return decodeURIComponent(value.join("=")); } catch { return null; }
    }
  }
  return null;
}

function safeDecode(value: string) { try { return decodeURIComponent(value); } catch { return null; } }

export function organizationSelectionCookie(organizationId: string) {
  return `${ORGANIZATION_COOKIE}=${encodeURIComponent(organizationId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export async function apiRoute(operation: () => Promise<Response>): Promise<Response> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    console.error("H.OIKOS API failure", error);
    return Response.json({ error: "Não foi possível concluir a operação.", code: "internal_error" }, { status: 500 });
  }
}

export async function jsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new ApiError(400, "invalid_json", "O corpo da requisição não é um JSON válido."); }
}

export function auditStatement(
  context: OrganizationContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  return context.db.prepare(
    `INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(crypto.randomUUID(), context.organization.id, context.member.externalUserId, action, entityType, entityId, JSON.stringify(metadata), Date.now());
}

export function ensureFound<T>(value: T | null, entity: string): T {
  if (!value) throw new ApiError(404, "not_found", `${entity} não encontrado.`);
  return value;
}

export function validationError(fields: unknown) {
  return new ApiError(400, "validation_error", "Revise os campos informados.", fields);
}
