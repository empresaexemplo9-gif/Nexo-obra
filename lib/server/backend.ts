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
  const userId = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim();

  if (!userId || !email) {
    throw new ApiError(
      401,
      "sign_in_required",
      "Entre com sua conta para acessar os dados da empresa.",
    );
  }

  const db = getDatabase();
  const membership = await db
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
        o.name
      LIMIT 1`,
    )
    .bind(userId, email)
    .first<MembershipRow>();

  if (!membership) {
    throw new ApiError(
      403,
      "membership_required",
      "Sua conta ainda não pertence a uma empresa no Nexo Obra.",
    );
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new ApiError(
      403,
      "insufficient_permission",
      "Seu perfil não permite executar esta ação.",
    );
  }

  return {
    db,
    user: {
      id: userId,
      email,
      displayName: membership.member_name || email,
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
