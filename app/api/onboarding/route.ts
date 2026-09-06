import { z } from "zod";

import {
  apiRoute,
  authenticatedIdentity,
  jsonBody,
  organizationSelectionCookie,
  validationError,
} from "@/lib/server/backend";
import { getDatabase } from "@/db";
import { requestEvidenceHashes } from "@/lib/server/terms";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { permissionsForRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const onboardingSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  acceptTerms: z.literal(true),
});

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "empresa";
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const user = authenticatedIdentity(request);
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
    const evidence = await requestEvidenceHashes(request);

    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)`,
      ).bind(userId, user.email, user.displayName, now),
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
          permissions_json, weekly_capacity_minutes, active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'owner', ?6, 2400, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(memberId, organizationId, userId, user.displayName, user.email, JSON.stringify(permissionsForRole("owner"))),
      db.prepare(
        `INSERT INTO audit_events (
          id, organization_id, actor_user_id, action, entity_type, entity_id,
          metadata_json, created_at
        ) VALUES (?1, ?2, ?3, 'organization.created', 'organization', ?2, '{}', ?4)`,
      ).bind(crypto.randomUUID(), organizationId, userId, now),
      db.prepare(
        `INSERT INTO terms_acceptances (
          id, organization_id, external_user_id, email, terms_version,
          invitation_id, ip_hash, user_agent_hash, accepted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)`,
      ).bind(crypto.randomUUID(), organizationId, user.id, user.email, CURRENT_TERMS_VERSION, evidence.ipHash, evidence.userAgentHash, now),
    ]);

    return Response.json(
      {
        organization: {
          id: organizationId,
          name: parsed.data.organizationName,
          slug,
          timezone: "America/Sao_Paulo",
        },
        member: { id: memberId, role: "owner" },
        created: true,
      },
      {
        status: 201,
        headers: { "Set-Cookie": organizationSelectionCookie(organizationId) },
      },
    );
  });
}
