import { getDatabase } from "@/db";
import { ApiError, apiRoute } from "@/lib/server/backend";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ invitationId: string }> };

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    await requireSuperAdmin(request);
    const { invitationId } = await route.params;
    const db = getDatabase();
    const invitation = await db.prepare(
      "SELECT id, accepted_at, revoked_at FROM organization_invitations WHERE id = ?1",
    ).bind(invitationId).first<{ id: string; accepted_at: number | null; revoked_at: number | null }>();
    if (!invitation) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    if (invitation.accepted_at) throw new ApiError(409, "invitation_used", "Este convite já foi utilizado.");
    if (!invitation.revoked_at) {
      await db.prepare("UPDATE organization_invitations SET revoked_at = ?1 WHERE id = ?2")
        .bind(Date.now(), invitationId).run();
    }
    return Response.json({ revoked: true });
  });
}
