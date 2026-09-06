import { getDatabase } from "@/db";
import { ApiError, apiRoute } from "@/lib/server/backend";
import { invitationTokenHash, validateInvitationState } from "@/lib/server/invitations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };
type InvitationRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  role: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
};

export async function GET(_request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { token } = await route.params;
    if (token.length < 32 || token.length > 100) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    const tokenHash = await invitationTokenHash(token);
    const invitation = await getDatabase().prepare(
      `SELECT i.id, i.organization_id, o.name AS organization_name, i.email, i.role,
        i.expires_at, i.accepted_at, i.revoked_at
       FROM organization_invitations i
       INNER JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = ?1`,
    ).bind(tokenHash).first<InvitationRow>();
    if (!invitation) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    validateInvitationState(invitation);
    return Response.json({ invitation: {
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organization_name,
      expiresAt: invitation.expires_at,
    } });
  });
}
