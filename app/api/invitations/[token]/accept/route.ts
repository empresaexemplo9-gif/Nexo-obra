import { getDatabase } from "@/db";
import {
  ApiError,
  apiRoute,
  authenticatedIdentity,
  organizationSelectionCookie,
} from "@/lib/server/backend";
import { invitationTokenHash, validateInvitationState } from "@/lib/server/invitations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };
type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
};

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const identity = authenticatedIdentity(request);
    const { token } = await route.params;
    if (token.length < 32 || token.length > 100) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    const db = getDatabase();
    const tokenHash = await invitationTokenHash(token);
    const invitation = await db.prepare(
      `SELECT id, organization_id, email, role, expires_at, accepted_at, revoked_at
       FROM organization_invitations WHERE token_hash = ?1`,
    ).bind(tokenHash).first<InvitationRow>();
    if (!invitation) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    validateInvitationState(invitation);
    if (identity.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      throw new ApiError(403, "invitation_email_mismatch", `Entre com o e-mail ${invitation.email} para aceitar este convite.`);
    }

    const now = Date.now();
    const legacyUser = await db.prepare("SELECT id FROM users WHERE id = ?1 OR lower(email) = lower(?2) LIMIT 1")
      .bind(identity.id, identity.email).first<{ id: string }>();
    const userId = legacyUser?.id ?? identity.id;
    const existingMember = await db.prepare(
      `SELECT id, role FROM members
       WHERE organization_id = ?1 AND (external_user_id = ?2 OR lower(email) = lower(?3)) LIMIT 1`,
    ).bind(invitation.organization_id, identity.id, identity.email).first<{ id: string; role: string }>();
    const memberId = existingMember?.id ?? crypto.randomUUID();
    const role = existingMember?.role === "owner" ? "owner" : invitation.role;

    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)`,
      ).bind(userId, identity.email, identity.displayName, now),
      existingMember
        ? db.prepare(
          `UPDATE members SET external_user_id = ?1, name = ?2, email = ?3, role = ?4,
           active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?5 AND organization_id = ?6`,
        ).bind(identity.id, identity.displayName, identity.email, role, memberId, invitation.organization_id)
        : db.prepare(
          `INSERT INTO members (
            id, organization_id, external_user_id, name, email, role,
            weekly_capacity_minutes, active, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 2400, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ).bind(memberId, invitation.organization_id, identity.id, identity.displayName, identity.email, role),
      db.prepare(
        `INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(organization_id, user_id) DO UPDATE SET role = CASE
           WHEN organization_members.role = 'owner' THEN 'owner' ELSE excluded.role END`,
      ).bind(memberId, invitation.organization_id, userId, role, now),
      db.prepare(
        `UPDATE organization_invitations
         SET accepted_at = ?1, accepted_by_user_id = ?2
         WHERE id = ?3 AND accepted_at IS NULL AND revoked_at IS NULL`,
      ).bind(now, identity.id, invitation.id),
      db.prepare(
        `INSERT INTO audit_events (
          id, organization_id, actor_user_id, action, entity_type, entity_id,
          metadata_json, created_at
        ) VALUES (?1, ?2, ?3, 'invitation.accepted', 'invitation', ?4, ?5, ?6)`,
      ).bind(crypto.randomUUID(), invitation.organization_id, userId, invitation.id, JSON.stringify({ role }), now),
    ]);

    return Response.json(
      { accepted: true, organizationId: invitation.organization_id, role },
      { headers: { "Set-Cookie": organizationSelectionCookie(invitation.organization_id) } },
    );
  });
}
