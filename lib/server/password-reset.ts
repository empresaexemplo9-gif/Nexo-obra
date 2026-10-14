import { getDatabase } from "@/db";
import { ApiError, canManageOrganizationAccess, isPlatformSuperAdmin, type OrganizationContext } from "@/lib/server/backend";
import { assertPasswordStrength, hashPassword } from "@/lib/server/auth";
import { createInvitationToken, invitationTokenHash } from "@/lib/server/invitations";
import { parseStoredPermissions, permissionsBeyond } from "@/lib/permissions";

// Nova senha por link de uso único.
//
// A plataforma não envia e-mail. Quem esquece a senha pede a um administrador da empresa,
// que gera aqui um link e o entrega como entrega o convite. A senha é uma só para todas as
// empresas da pessoa, então o administrador de uma empresa não pode gerar o link de quem
// também está em outra — isso seria tomar a conta dela lá. Nesses casos, e para o
// contratante, só o superadministrador gera.

const RESET_TTL_MS = 24 * 60 * 60 * 1000;

type MemberRow = { id: string; external_user_id: string; email: string; name: string; role: string; active: number; permissions_json: string };

export async function createPasswordReset(context: OrganizationContext, memberId: string) {
  if (!canManageOrganizationAccess(context)) {
    throw new ApiError(403, "access_management_denied", "Somente administradores autorizados podem gerar link de nova senha.");
  }
  const db = context.db;
  const target = await db.prepare(
    "SELECT id, external_user_id, email, name, role, active, permissions_json FROM members WHERE id = ?1 AND organization_id = ?2 AND role != 'superadmin'",
  ).bind(memberId, context.organization.id).first<MemberRow>();
  if (!target) throw new ApiError(404, "member_not_found", "Acesso não encontrado nesta empresa.");
  if (target.id === context.member.id) {
    throw new ApiError(400, "own_password_reset", "Para trocar a sua própria senha, use “Trocar senha” no menu da conta.");
  }
  if (target.active !== 1) throw new ApiError(409, "member_inactive", "Reative o acesso antes de gerar uma nova senha.");

  const superAdmin = isPlatformSuperAdmin(context);
  if (!superAdmin) {
    if (target.role === "owner") {
      throw new ApiError(403, "owner_password_reset", "A senha do contratante só pode ser redefinida pelo superadministrador da plataforma.");
    }
    if (context.member.role !== "owner"
      && permissionsBeyond(parseStoredPermissions(target.permissions_json, target.role), context.member.permissions).length) {
      throw new ApiError(403, "permission_beyond_grantor", "Você só pode gerar nova senha para acessos dentro do seu próprio nível.");
    }
    const elsewhere = await db.prepare(
      `SELECT 1 AS found FROM members WHERE external_user_id = ?1 AND organization_id != ?2
       UNION SELECT 1 FROM organization_members WHERE user_id = ?1 AND organization_id != ?2
       UNION SELECT 1 FROM client_portal_access WHERE external_user_id = ?1 AND organization_id != ?2
       LIMIT 1`,
    ).bind(target.external_user_id, context.organization.id).first<{ found: number }>();
    if (elsewhere) {
      throw new ApiError(403, "shared_account_password_reset", "Esta pessoa também usa a conta em outra empresa. Peça a nova senha ao superadministrador da plataforma.");
    }
  }

  // A credencial é por e-mail: se o e-mail já pertence a outra conta, o link não pode trocá-la.
  const owner = await db.prepare("SELECT user_id FROM user_credentials WHERE email = ?1")
    .bind(target.email.trim().toLowerCase()).first<{ user_id: string }>();
  if (owner && owner.user_id !== target.external_user_id) {
    throw new ApiError(409, "credential_mismatch", "O e-mail deste acesso pertence a outra conta. Peça ajuda ao superadministrador.");
  }

  const token = createInvitationToken();
  const now = Date.now();
  const expiresAt = now + RESET_TTL_MS;
  await db.batch([
    db.prepare("UPDATE password_resets SET revoked_at = ?1 WHERE user_id = ?2 AND used_at IS NULL AND revoked_at IS NULL")
      .bind(now, target.external_user_id),
    db.prepare(
      `INSERT INTO password_resets (id, token_hash, user_id, email, organization_id, created_by, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(crypto.randomUUID(), await invitationTokenHash(token), target.external_user_id, target.email.trim().toLowerCase(),
      context.organization.id, context.user.id, expiresAt, now),
    db.prepare(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?1, ?2, ?3, 'member.password_reset_issued', 'member', ?4, ?5, ?6)`,
    ).bind(crypto.randomUUID(), context.organization.id, context.user.id, target.id, JSON.stringify({ email: target.email, expiresAt }), now),
  ]);
  return { path: `/redefinir-senha/${token}`, expiresAt, email: target.email };
}

type ResetRow = { id: string; user_id: string; email: string; organization_id: string; expires_at: number; used_at: number | null; revoked_at: number | null };

async function findReset(token: string) {
  const row = await getDatabase().prepare(
    "SELECT id, user_id, email, organization_id, expires_at, used_at, revoked_at FROM password_resets WHERE token_hash = ?1",
  ).bind(await invitationTokenHash(token)).first<ResetRow>();
  if (!row) throw new ApiError(404, "password_reset_not_found", "Link de nova senha inválido.");
  if (row.used_at) throw new ApiError(409, "password_reset_used", "Este link já foi usado. Peça um novo ao administrador.");
  if (row.revoked_at) throw new ApiError(410, "password_reset_revoked", "Este link foi substituído por outro mais recente.");
  if (row.expires_at <= Date.now()) throw new ApiError(410, "password_reset_expired", "Este link expirou. Peça um novo ao administrador.");
  return row;
}

export async function readPasswordReset(token: string) {
  const row = await findReset(token);
  return { email: row.email, expiresAt: row.expires_at };
}

export async function redeemPasswordReset(token: string, password: string) {
  assertPasswordStrength(password);
  const row = await findReset(token);
  const db = getDatabase();
  const member = await db.prepare("SELECT name FROM members WHERE external_user_id = ?1 AND organization_id = ?2")
    .bind(row.user_id, row.organization_id).first<{ name: string }>();
  const hash = await hashPassword(password);
  const now = Date.now();
  // O UPDATE condicional é o que garante o uso único mesmo com dois envios simultâneos.
  const results = await db.batch([
    db.prepare("UPDATE password_resets SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1")
      .bind(now, row.id),
    db.prepare(
      `INSERT INTO user_credentials (user_id, email, password_hash, display_name, active, password_updated_at, created_at)
       SELECT ?1, ?2, ?3, ?4, 1, ?5, ?5 WHERE changes() = 1
       ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, password_updated_at = excluded.password_updated_at, active = 1`,
    ).bind(row.user_id, row.email, hash, member?.name ?? row.email, now),
    db.prepare(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       SELECT ?1, ?2, ?3, 'member.password_reset_used', 'user', ?3, '{}', ?4
       WHERE EXISTS (SELECT 1 FROM password_resets WHERE id = ?5 AND used_at = ?4)`,
    ).bind(crypto.randomUUID(), row.organization_id, row.user_id, now, row.id),
  ]);
  if (!results[0].meta.changes) throw new ApiError(409, "password_reset_used", "Este link já foi usado. Peça um novo ao administrador.");
  return { email: row.email };
}
