import { z } from "zod";
import {
  ApiError, apiRoute, canManageOrganizationAccess, isPlatformSuperAdmin, jsonBody,
  requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { assertPlatformAccess } from "@/lib/server/platform-access";
import { assertPasswordStrength, hashPassword, saveCredentialStatement } from "@/lib/server/auth";
import { membroPodeCriarContas } from "@/lib/server/empresa-config";
import { excedeQuemConcede, perfisCriaveis, podeCriarPerfil } from "@/lib/empresa-config";
import { accessProfileLabels, normalizePermissions, permissionModuleLabels, permissionModules } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160).transform((valor) => valor.toLowerCase()),
  password: z.string().min(1).max(200),
  role: z.enum(perfisCriaveis),
  permissions: z.record(z.string(), z.object({ view: z.boolean(), edit: z.boolean() }).strict()),
}).strict();

/**
 * Cria login e senha direto, sem link de convite, para quem está abaixo de quem cria.
 *
 * Pode criar: o contratante, um administrador de Equipe, ou alguém a quem o contratante
 * entregou essa ferramenta. Três travas valem para todos, menos para o contratante e a
 * plataforma, que já têm tudo: o perfil novo fica abaixo do de quem cria, a matriz não
 * passa da de quem cria, e o e-mail não pode já ter senha — definir a senha de quem já
 * usa a plataforma seria tomar a conta dela.
 */
export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "view");
    const total = context.member.role === "owner" || isPlatformSuperAdmin(context);
    const autorizado = total || canManageOrganizationAccess(context)
      || await membroPodeCriarContas(context.db, context.organization.id, context.member.id);
    if (!autorizado) throw new ApiError(403, "account_creation_denied", "O contratante ainda não liberou para você a criação de acessos.");

    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    if (!total && !podeCriarPerfil(context.member.role, data.role)) {
      throw new ApiError(403, "role_above_creator",
        `Seu perfil não cria acesso de ${accessProfileLabels[data.role] ?? data.role}. Escolha um cargo abaixo do seu.`);
    }
    const permissions = normalizePermissions(data.permissions, data.role);
    if (!permissionModules.some((modulo) => permissions[modulo].view)) {
      throw new ApiError(400, "empty_permissions", "Marque ao menos uma área como visível.");
    }
    if (!total) {
      const alem = excedeQuemConcede(permissions, context.member.permissions, context.organization.enabledModules);
      if (alem.length) {
        throw new ApiError(403, "permission_beyond_grantor",
          `Você não pode liberar mais do que o seu próprio acesso: ${alem.map((modulo) => permissionModuleLabels[modulo]).join(", ")}.`);
      }
    }
    assertPasswordStrength(data.password);

    const db = context.db;
    const credencial = await db.prepare("SELECT user_id FROM user_credentials WHERE email = ?1").bind(data.email).first();
    if (credencial) {
      throw new ApiError(409, "account_exists",
        "Este e-mail já tem senha na plataforma. Envie um convite por link: a pessoa entra com a senha dela e aceita.");
    }
    const jaMembro = await db.prepare("SELECT id FROM members WHERE organization_id = ?1 AND lower(email) = ?2 AND role != 'superadmin'")
      .bind(context.organization.id, data.email).first();
    if (jaMembro) throw new ApiError(409, "member_exists", "Este e-mail já pertence à empresa. Gerencie o acesso existente.");
    await assertPlatformAccess(context.organization.id, data.email, undefined, false);

    const legado = await db.prepare("SELECT id FROM users WHERE lower(email) = ?1 LIMIT 1").bind(data.email).first<{ id: string }>();
    const userId = legado?.id ?? crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const agora = Date.now();
    const passwordHash = await hashPassword(data.password);
    const [, credencialGravada] = await db.batch([
      db.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
        .bind(userId, data.email, data.name, agora),
      saveCredentialStatement(db, { id: userId, email: data.email, displayName: data.name }, passwordHash, agora),
      db.prepare(`INSERT INTO members (
          id, organization_id, external_user_id, name, email, role,
          permissions_json, weekly_capacity_minutes, active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 2400, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
        .bind(memberId, context.organization.id, userId, data.name, data.email, data.role, JSON.stringify(permissions)),
      db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(organization_id, user_id) DO NOTHING`)
        .bind(memberId, context.organization.id, userId, data.role, agora),
      // A senha nunca entra no rastro; quem criou e para quem, sim.
      db.prepare(`INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
        VALUES (?1, ?2, ?3, 'member.account_created', 'member', ?4, ?5, ?6)`)
        .bind(crypto.randomUUID(), context.organization.id, context.member.externalUserId, memberId,
          JSON.stringify({ email: data.email, role: data.role, permissions, createdBy: context.user.email }), agora),
    ]);
    if (!credencialGravada.meta?.changes) {
      // Corrida: outra requisição criou a senha deste e-mail entre a conferência e a gravação.
      await db.batch([
        db.prepare("DELETE FROM organization_members WHERE id = ?1 AND organization_id = ?2").bind(memberId, context.organization.id),
        db.prepare("DELETE FROM members WHERE id = ?1 AND organization_id = ?2").bind(memberId, context.organization.id),
      ]);
      throw new ApiError(409, "account_exists", "Este e-mail acabou de receber senha em outra solicitação. Envie um convite por link.");
    }
    return Response.json({
      member: { id: memberId, name: data.name, email: data.email, role: data.role, permissions },
    }, { status: 201 });
  });
}
