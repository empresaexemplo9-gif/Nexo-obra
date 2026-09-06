import { getDatabase } from "@/db";
import { parseStoredPermissions, type PermissionAction, type PermissionModule, type PermissionSet } from "@/lib/permissions";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { MAINTENANCE_ORGANIZATION_ID, readMaintenanceIdentity } from "@/lib/server/maintenance";

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

export type AuthenticatedIdentity = { id: string; email: string; displayName: string; scope?: "maintenance" };
const ORGANIZATION_COOKIE = "__Host-nexo-organization";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function requireOrganizationContext(
  request: Request,
  allowedRoles?: readonly string[],
  options: { allowUnacceptedTerms?: boolean } = {},
): Promise<OrganizationContext> {
  const identity = await authenticatedIdentity(request);
  const db = getDatabase();
  const memberships = await findMemberships(db, identity);
  if (memberships.length === 0) {
    throw new ApiError(403, "membership_required", "Sua conta ainda não pertence a uma empresa no Nexo Obra.");
  }
  const requestedOrganizationId = selectedOrganizationId(request);
  const membership = memberships.find((item) => item.organization_id === requestedOrganizationId) ?? memberships[0];
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
  return findMemberships(getDatabase(), identity);
}

async function findMemberships(db: D1Database, identity: AuthenticatedIdentity) {
  const maintenanceFilter = identity.scope === "maintenance" ? " AND m.organization_id = ?3" : "";
  const result = await db.prepare(
    `SELECT m.id AS member_id, m.external_user_id, m.name AS member_name, m.email,
      m.role, m.permissions_json, o.id AS organization_id, o.name AS organization_name,
      o.slug AS organization_slug, o.timezone
     FROM members m INNER JOIN organizations o ON o.id = m.organization_id
     WHERE m.active = 1 AND (m.external_user_id = ?1 OR lower(m.email) = lower(?2))${maintenanceFilter}
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

export function requireModulePermission(context: OrganizationContext, module: PermissionModule, action: PermissionAction) {
  if (!context.member.permissions[module][action]) {
    throw new ApiError(403, "module_permission_denied", "Seu acesso não permite esta operação.");
  }
}

export function canManageOrganizationAccess(context: OrganizationContext) {
  return context.member.role === "owner" || (context.member.role === "admin" && context.member.permissions.team.edit);
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
    console.error("Nexo Obra API failure", error);
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
