import { ApiError, apiRoute, auditStatement, canManageOrganizationAccess, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ invitationId: string }> };

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "edit");
    if (!canManageOrganizationAccess(context)) {
      throw new ApiError(403, "access_management_denied", "Seu perfil não pode revogar acessos.");
    }
    const { invitationId } = await route.params;
    const invitation = await context.db.prepare(
      `SELECT id, accepted_at, revoked_at FROM organization_invitations
       WHERE id = ?1 AND organization_id = ?2`,
    ).bind(invitationId, context.organization.id).first<{ id: string; accepted_at: number | null; revoked_at: number | null }>();
    if (!invitation) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    if (invitation.accepted_at) throw new ApiError(409, "invitation_used", "Este convite já foi utilizado.");
    if (!invitation.revoked_at) {
      await context.db.batch([
        context.db.prepare("UPDATE organization_invitations SET revoked_at = ?1 WHERE id = ?2 AND organization_id = ?3")
          .bind(Date.now(), invitationId, context.organization.id),
        auditStatement(context, "invitation.revoked", "invitation", invitationId),
      ]);
    }
    return Response.json({ revoked: true });
  });
}
