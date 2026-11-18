import { z } from "zod";
import {
  ApiError, apiRoute, canManageOrganizationAccess, isPlatformSuperAdmin, jsonBody,
  requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { perfisQueRecebemDelegacao, podeCriarPerfil } from "@/lib/empresa-config";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ memberId: string }> };
const schema = z.object({ canCreateAccounts: z.boolean() }).strict();

/** O contratante (ou administrador de Equipe) entrega ou retira de um gestor a criação de login. */
export async function PUT(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "edit");
    if (!canManageOrganizationAccess(context)) {
      throw new ApiError(403, "access_management_denied", "Somente o contratante ou um administrador autorizado entrega esta ferramenta.");
    }
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const { memberId } = await route.params;
    const alvo = await context.db.prepare("SELECT id, role, active FROM members WHERE id = ?1 AND organization_id = ?2 AND role != 'superadmin'")
      .bind(memberId, context.organization.id).first<{ id: string; role: string; active: number }>();
    if (!alvo) throw new ApiError(404, "member_not_found", "Acesso não encontrado nesta empresa.");
    if (alvo.id === context.member.id) throw new ApiError(403, "protected_member", "Você não altera a própria ferramenta de criar acessos.");
    if (!(perfisQueRecebemDelegacao as readonly string[]).includes(alvo.role)) {
      throw new ApiError(400, "role_cannot_delegate", "Esta ferramenta é para cargos de gestão: administrador, gestor, financeiro, RH e contabilidade.");
    }
    // Um administrador só entrega a ferramenta a quem está abaixo dele.
    if (context.member.role !== "owner" && !isPlatformSuperAdmin(context) && !podeCriarPerfil(context.member.role, alvo.role)) {
      throw new ApiError(403, "role_above_granter", "Você só entrega esta ferramenta a cargos abaixo do seu.");
    }
    const agora = Date.now();
    await context.db.batch([
      context.db.prepare(`INSERT INTO member_delegations (member_id, organization_id, can_create_accounts, updated_by, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(member_id) DO UPDATE SET
          can_create_accounts = excluded.can_create_accounts, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(alvo.id, context.organization.id, parsed.data.canCreateAccounts ? 1 : 0, context.user.email, agora),
      context.db.prepare(`INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
        VALUES (?1, ?2, ?3, 'member.delegation_changed', 'member', ?4, ?5, ?6)`)
        .bind(crypto.randomUUID(), context.organization.id, context.member.externalUserId, alvo.id,
          JSON.stringify({ canCreateAccounts: parsed.data.canCreateAccounts }), agora),
    ]);
    return Response.json({ memberId: alvo.id, canCreateAccounts: parsed.data.canCreateAccounts });
  });
}
