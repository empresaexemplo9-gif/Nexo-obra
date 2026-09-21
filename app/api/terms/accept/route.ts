import { z } from "zod";

import { ApiError, apiRoute, isPlatformSuperAdmin, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { requestEvidenceHashes } from "@/lib/server/terms";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const acceptanceSchema = z.object({
  accepted: z.literal(true),
  version: z.literal(CURRENT_TERMS_VERSION),
}).strict();

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request, undefined, { allowUnacceptedTerms: true });
    // O aceite é uma evidência jurídica do contratante. A plataforma não assina por ele.
    if (isPlatformSuperAdmin(context)) {
      throw new ApiError(403, "superadmin_scope", "O aceite dos termos pertence ao contratante da empresa.");
    }
    const parsed = acceptanceSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const evidence = await requestEvidenceHashes(request);
    const acceptedAt = Date.now();
    await context.db.prepare(
      `INSERT INTO terms_acceptances (
        id, organization_id, external_user_id, email, terms_version,
        invitation_id, ip_hash, user_agent_hash, accepted_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)
      ON CONFLICT(organization_id, external_user_id, terms_version) DO NOTHING`,
    ).bind(
      crypto.randomUUID(), context.organization.id, context.user.id, context.user.email,
      CURRENT_TERMS_VERSION, evidence.ipHash, evidence.userAgentHash, acceptedAt,
    ).run();
    const evidenceRecord = await context.db.prepare("SELECT accepted_at FROM terms_acceptances WHERE organization_id = ?1 AND external_user_id = ?2 AND terms_version = ?3")
      .bind(context.organization.id, context.user.id, CURRENT_TERMS_VERSION).first<{ accepted_at: number }>();
    return Response.json({ accepted: true, version: CURRENT_TERMS_VERSION, acceptedAt: evidenceRecord?.accepted_at ?? acceptedAt }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
