import { z } from "zod";
import { ApiError, apiRoute, canManageOrganizationAccess, isPlatformSuperAdmin, jsonBody, validationError, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { normalizePermissions, permissionsBeyond, permissionModules, parseStoredPermissions } from "@/lib/permissions";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  weekly_capacity_minutes: number;
  active: number;
  permissions_json: string;
  updated_at: string;
};

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "view");
    const result = await context.db.prepare(
      `SELECT id, name, email, role, permissions_json, weekly_capacity_minutes, active, updated_at
       FROM members
       WHERE organization_id = ?1 AND (active = 1 OR ?2 = 1) AND role != 'superadmin'
       ORDER BY name`,
    ).bind(context.organization.id, canManageOrganizationAccess(context) && new URL(request.url).searchParams.get("includeInactive") === "true" ? 1 : 0).all<MemberRow>();

    return Response.json({
      members: result.results.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        permissions: parseStoredPermissions(member.permissions_json, member.role),
        weeklyCapacityMinutes: member.weekly_capacity_minutes,
        active: member.active === 1,
        updatedAt: member.updated_at,
      })),
    });
  });
}

const updateSchema = z.object({
  id: z.string().min(1).max(120),
  role: z.enum(["admin", "manager", "member", "partner", "service_provider", "finance", "hr", "accounting"]),
  permissions: z.record(z.string(), z.object({ view: z.boolean(), edit: z.boolean() }).strict()),
  active: z.boolean(), weeklyCapacityMinutes: z.number().int().min(0).max(10080),
  updatedAt: z.string().min(1).max(100),
}).strict();

export async function PATCH(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "edit");
    if (!canManageOrganizationAccess(context)) throw new ApiError(403, "access_management_denied", "Somente administradores autorizados podem alterar acessos.");
    const parsed = updateSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const data = parsed.data;
    const target = await context.db.prepare("SELECT * FROM members WHERE id = ?1 AND organization_id = ?2 AND role != 'superadmin'").bind(data.id, context.organization.id).first<MemberRow>();
    if (!target) throw new ApiError(404, "member_not_found", "Acesso não encontrado nesta empresa.");
    if (target.role === "owner" || target.id === context.member.id) throw new ApiError(403, "protected_member", "O acesso do contratante e seu próprio acesso são protegidos. Outro administrador pode gerenciar seu perfil.");
    const permissions = normalizePermissions(data.permissions, data.role);
    if (!permissionModules.some(module => permissions[module].view)) throw new ApiError(400, "empty_permissions", "Selecione ao menos uma área visível.");
    if (context.member.role !== "owner" && !isPlatformSuperAdmin(context) &&
      (permissionsBeyond(permissions, context.member.permissions).length || permissionsBeyond(parseStoredPermissions(target.permissions_json, target.role), context.member.permissions).length)) {
      throw new ApiError(403, "permission_beyond_grantor", "Você só pode gerenciar acessos e permissões dentro do seu próprio nível.");
    }
    const results = await context.db.batch([
      context.db.prepare(`UPDATE members SET role = ?1, permissions_json = ?2, active = ?3, weekly_capacity_minutes = ?4, updated_at = ?5
        WHERE id = ?6 AND organization_id = ?7 AND updated_at = ?8`)
        .bind(data.role, JSON.stringify(permissions), data.active ? 1 : 0, data.weeklyCapacityMinutes, `${new Date().toISOString()}:${crypto.randomUUID()}`, data.id, context.organization.id, data.updatedAt),
      context.db.prepare(`INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
        SELECT ?1, ?2, ?3, 'member.access_updated', 'member', ?4, ?5, ?6 WHERE changes() = 1`)
        .bind(crypto.randomUUID(), context.organization.id, context.user.id, data.id, JSON.stringify({ before: { role: target.role, active: target.active, permissions: parseStoredPermissions(target.permissions_json, target.role) }, after: { role: data.role, active: data.active, permissions, weeklyCapacityMinutes: data.weeklyCapacityMinutes } }), Date.now()),
    ]);
    if (!results[0].meta.changes) throw new ApiError(409, "member_conflict", "Este acesso foi alterado em outra sessão. Atualize a lista e tente novamente.");
    return Response.json({ updated: true });
  });
}
