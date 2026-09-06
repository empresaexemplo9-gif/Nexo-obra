import { z } from "zod";

import { apiRoute, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { requestEvidenceHashes } from "@/lib/server/terms";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export const dynamic = "force-dynamic";

const acceptanceSchema = z.object({
  accepted: z.literal(true),
  version: z.literal(CURRENT_TERMS_VERSION),
});

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, undefined, { allowUnacceptedTerms: true });
    const parsed = acceptanceSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const evidence = await requestEvidenceHashes(request);
    const acceptedAt = Date.now();
    await context.db.prepare(
      `INSERT INTO terms_acceptances (
        id, organization_id, external_user_id, email, terms_version,
        invitation_id, ip_hash, user_agent_hash, accepted_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)
      ON CONFLICT(organization_id, external_user_id, terms_version) DO UPDATE SET
        email = excluded.email,
        ip_hash = excluded.ip_hash,
        user_agent_hash = excluded.user_agent_hash,
        accepted_at = excluded.accepted_at`,
    ).bind(
      crypto.randomUUID(), context.organization.id, context.user.id, context.user.email,
      CURRENT_TERMS_VERSION, evidence.ipHash, evidence.userAgentHash, acceptedAt,
    ).run();
    return Response.json({ accepted: true, version: CURRENT_TERMS_VERSION, acceptedAt });
  });
}
