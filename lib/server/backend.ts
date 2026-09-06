import { getDatabase } from "@/db";

export const operationalRoles = ["owner", "admin", "manager", "member"] as const;
export const managementRoles = ["owner", "admin", "manager"] as const;

export type OrganizationContext = {
  db: D1Database;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  member: {
    id: string;
    externalUserId: string;
    role: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  };
};

type MembershipRow = {
  member_id: string;
  external_user_id: string;
  member_name: string;
  email: string;
  role: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  timezone: string;
};

export type AuthenticatedIdentity = {
  id: string;
  email: string;
  displayName: string;
};

const ORGANIZATION_COOKIE = "__Host-nexo-organization";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function requireOrganizationContext(
  request: Request,
  allowedRoles?: readonly string[],
): Promise<OrganizationContext> {
  const identity = authenticatedIdentity(request);
  const db = getDatabase();
  const memberships = await findMemberships(db, identity);

  if (memberships.length === 0) {
    throw new ApiError(
      403,
      "membership_required",
      "Sua conta ainda não pertence a uma empresa no Nexo Obra.",
    );
  }

  const requestedOrganizationId = selectedOrganizationId(request);
  const membership = memberships.find(
    (item) => item.organization_id === requestedOrganizationId,
  ) ?? memberships[0];

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new ApiError(
      403,
      "insufficient_permission",
      "Seu perfil não permite executar esta ação.",
    );
  }

  return contextFromMembership(db, identity, membership);
}

export function authenticatedIdentity(request: Request): AuthenticatedIdentity {
  const userId = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim();

  if (!userId || !email) {
    throw new ApiError(
      401,
      "sign_in_required",
      "Entre com sua conta para acessar os dados da empresa.",
    );
  }

  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const displayName = encodedName &&
    request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
    ? safeDecode(encodedName) ?? email
    : email;

  return { id: userId, email, displayName };
}

export async function listOrganizationMemberships(request: Request) {
  const identity = authenticatedIdentity(request);
  const db = getDatabase();
  return findMemberships(db, identity);
}

async function findMemberships(db: D1Database, identity: AuthenticatedIdentity) {
  const result = await db
    .prepare(
      `SELECT
        m.id AS member_id,
        m.external_user_id,
        m.name AS member_name,
        m.email,
        m.role,
        o.id AS organization_id,
        o.name AS organization_name,
        o.slug AS organization_slug,
        o.timezone
      FROM members m
      INNER JOIN organizations o ON o.id = m.organization_id
      WHERE m.active = 1
        AND (m.external_user_id = ?1 OR lower(m.email) = lower(?2))
      ORDER BY
        CASE m.role
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'manager' THEN 3
          WHEN 'member' THEN 4
          ELSE 5
        END,
        o.name`,
    )
    .bind(identity.id, identity.email)
    .all<MembershipRow>();
  return result.results;
}

function contextFromMembership(
  db: D1Database,
  identity: AuthenticatedIdentity,
  membership: MembershipRow,
): OrganizationContext {
  return {
    db,
    user: {
      id: identity.id,
      email: identity.email,
      displayName: membership.member_name || identity.displayName,
    },
    member: {
      id: membership.member_id,
      externalUserId: membership.external_user_id,
      role: membership.role,
    },
    organization: {
      id: membership.organization_id,
      name: membership.organization_name,
      slug: membership.organization_slug,
      timezone: membership.timezone,
    },
  };
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

function safeDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return null; }
}

export function organizationSelectionCookie(organizationId: string) {
  return `${ORGANIZATION_COOKIE}=${encodeURIComponent(organizationId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

export async function apiRoute(
  operation: () => Promise<Response>,
): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }

    console.error("Nexo Obra API failure", error);
    return Response.json(
      { error: "Não foi possível concluir a operação.", code: "internal_error" },
      { status: 500 },
    );
  }
}

export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "O corpo da requisição não é um JSON válido.");
  }
}

export function auditStatement(
  context: OrganizationContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  return context.db
    .prepare(
      `INSERT INTO audit_events (
        id, organization_id, actor_user_id, action, entity_type, entity_id,
        metadata_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      crypto.randomUUID(),
      context.organization.id,
      context.member.externalUserId,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
      Date.now(),
    );
}

export function ensureFound<T>(value: T | null, entity: string): T {
  if (!value) {
    throw new ApiError(404, "not_found", `${entity} não encontrado.`);
  }
  return value;
}

export function validationError(fields: unknown) {
  return new ApiError(400, "validation_error", "Revise os campos informados.", fields);
}
