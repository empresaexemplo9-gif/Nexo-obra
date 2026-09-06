import { z } from "zod";

import { ApiError, apiRoute, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
});

function identity(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const name = encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
    ? decodeName(encodedName)
    : null;
  if (!id || !email) throw new ApiError(401, "sign_in_required", "Entre com sua conta para criar a empresa.");
  return { id, email, name: name || email };
}

function decodeName(value: string) {
  try { return decodeURIComponent(value); } catch { return null; }
}

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "empresa";
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const user = identity(request);
    try {
      const existing = await requireOrganizationContext(request);
      return Response.json({
        organization: existing.organization,
        member: { id: existing.member.id, role: existing.member.role },
        created: false,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "membership_required") throw error;
    }

    const parsed = onboardingSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const db = getDatabase();
    const legacyUser = await db.prepare("SELECT id FROM users WHERE id = ?1 OR lower(email) = lower(?2) LIMIT 1")
      .bind(user.id, user.email).first<{ id: string }>();
    const userId = legacyUser?.id ?? user.id;
    const organizationId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const suffix = organizationId.replaceAll("-", "").slice(0, 8);
    const slug = `${slugify(parsed.data.organizationName)}-${suffix}`;
    const now = Date.now();

    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)`,
      ).bind(userId, user.email, user.name, now),
      db.prepare(
        `INSERT INTO organizations (id, name, slug, timezone, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'America/Sao_Paulo', ?4, ?4)`,
      ).bind(organizationId, parsed.data.organizationName, slug, now),
      db.prepare(
        `INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
         VALUES (?1, ?2, ?3, 'owner', ?4)`,
      ).bind(memberId, organizationId, userId, now),
      db.prepare(
        `INSERT INTO members (
          id, organization_id, external_user_id, name, email, role,
          weekly_capacity_minutes, active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'owner', 2400, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(memberId, organizationId, userId, user.name, user.email),
    ]);

    return Response.json({
      organization: {
        id: organizationId,
        name: parsed.data.organizationName,
        slug,
        timezone: "America/Sao_Paulo",
      },
      member: { id: memberId, role: "owner" },
      created: true,
    }, { status: 201 });
  });
}
