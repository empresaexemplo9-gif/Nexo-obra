import { getDatabase } from "@/db";
import { ApiError, apiRoute } from "@/lib/server/backend";
import { registrarExclusao } from "@/lib/server/exclusoes";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ invitationId: string }> };

/**
 * Duas coisas diferentes, e a diferença importa.
 *
 * **Revogar** (padrão) queima o convite: o link para de funcionar e a linha fica, porque
 * "este acesso foi oferecido e cancelado" é informação — alguém vai perguntar por que o
 * convite não abre.
 *
 * **Remover** (`?modo=remover`) apaga a linha. Serve para a lista de convites não virar
 * um depósito de tentativas antigas. Só alcança convite que já não vale nada: pendente
 * não some sem antes ser revogado, senão o link continuaria vivo com a linha apagada — um
 * acesso que ninguém mais consegue ver para cancelar.
 */
export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const { invitationId } = await route.params;
    const remover = new URL(request.url).searchParams.get("modo") === "remover";
    const db = getDatabase();
    const invitation = await db.prepare(
      "SELECT id, email, organization_id, accepted_at, revoked_at, expires_at FROM organization_invitations WHERE id = ?1",
    ).bind(invitationId).first<{ id: string; email: string; organization_id: string; accepted_at: number | null; revoked_at: number | null; expires_at: number }>();
    if (!invitation) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");

    if (remover) {
      const aindaVale = !invitation.accepted_at && !invitation.revoked_at && invitation.expires_at > Date.now();
      if (aindaVale) {
        throw new ApiError(
          409,
          "invitation_still_valid",
          "Este convite ainda abre. Revogue antes de remover, senão o link continua funcionando sem aparecer na lista.",
        );
      }
      await db.batch([
        db.prepare("DELETE FROM organization_invitations WHERE id = ?1").bind(invitationId),
        registrarExclusao(db, {
          tipo: "invitation",
          subjectId: invitationId,
          rotulo: invitation.email,
          actor: admin.email,
          detalhes: { organizationId: invitation.organization_id, aceito: Boolean(invitation.accepted_at) },
        }),
      ]);
      return Response.json({ removed: true });
    }

    if (invitation.accepted_at) throw new ApiError(409, "invitation_used", "Este convite já foi utilizado.");
    if (!invitation.revoked_at) {
      await db.prepare("UPDATE organization_invitations SET revoked_at = ?1 WHERE id = ?2")
        .bind(Date.now(), invitationId).run();
    }
    return Response.json({ revoked: true });
  });
}
