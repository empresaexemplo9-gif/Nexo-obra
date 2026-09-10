import { eq } from "drizzle-orm";

import { getDbOrNull } from "@/db";
import { members, organizations } from "@/db/schema";
import { resolveIdentity } from "@/lib/auth/identity";
import { ACTIVE_ORGANIZATION_COOKIE, getAuthState } from "@/lib/auth/session";
import { nowIso } from "@/lib/data/shared";
import { createOrganizationSchema } from "@/lib/domain/schemas";
import { apiError, handleRoute, parseJsonBody } from "@/lib/server/api";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

function slugify(value: string): string {
  return value
    .normalize("NFD")
    // Remove os diacríticos separados pelo NFD (faixa de combinantes).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Cria a empresa e torna quem criou o `owner`.
 *
 * É o primeiro passo do fluxo organização → cliente → projeto → tarefa. Exige
 * identidade autenticada, mas não exige vínculo prévio — é justamente o que
 * tira o usuário do estado "sem empresa".
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const identity = await resolveIdentity();
    if (!identity) {
      return apiError(401, "unauthorized", "Autenticação necessária.");
    }

    const db = getDbOrNull();
    if (!db) {
      return apiError(503, "unavailable", "Banco de dados indisponível no momento.");
    }

    const body = await parseJsonBody(request, createOrganizationSchema);
    if (!body.ok) return body.response;

    const slug = body.data.slug ?? slugify(body.data.name);
    if (!slug) {
      return apiError(422, "invalid_input", "Não foi possível derivar um identificador do nome.");
    }

    const [taken] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);

    if (taken) {
      return apiError(409, "conflict", `O identificador "${slug}" já está em uso.`);
    }

    const timestamp = nowIso();
    const organizationId = crypto.randomUUID();
    const memberId = crypto.randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      name: body.data.name,
      slug,
      timezone: body.data.timezone ?? "America/Sao_Paulo",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Quem cria a empresa é o proprietário. Sem isso a empresa nasceria órfã e
    // ninguém conseguiria administrá-la.
    await db.insert(members).values({
      id: memberId,
      organizationId,
      externalUserId: identity.subject,
      name: identity.displayName,
      email: identity.email,
      role: "owner",
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await recordAudit(db, {
      organizationId,
      actorMemberId: memberId,
      entity: "organization",
      entityId: organizationId,
      action: "create",
      changes: { name: { from: null, to: body.data.name }, slug: { from: null, to: slug } },
    });

    const response = Response.json(
      {
        organization: { id: organizationId, name: body.data.name, slug },
        member: { id: memberId, role: "owner" },
      },
      { status: 201 },
    );

    // Abre a empresa recém-criada na próxima navegação.
    response.headers.append(
      "Set-Cookie",
      `${ACTIVE_ORGANIZATION_COOKIE}=${organizationId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
    );

    return response;
  });
}

/** Lista as empresas do usuário autenticado. */
export async function GET() {
  return handleRoute(async () => {
    const state = await getAuthState();

    if (state.status === "anonymous") {
      return apiError(401, "unauthorized", "Autenticação necessária.");
    }
    if (state.status === "unavailable") {
      return apiError(503, "unavailable", "Banco de dados indisponível no momento.");
    }
    if (state.status === "no-organization") {
      return Response.json({ organizations: [] });
    }

    return Response.json({
      organizations: state.memberships.map((membership) => ({
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
        role: membership.role,
        active: membership.organizationId === state.active.organizationId,
      })),
    });
  });
}
