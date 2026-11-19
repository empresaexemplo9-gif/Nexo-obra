import { permissionsForRole } from "@/lib/permissions";
import { OIKOS_ORGANIZATION_ID } from "@/lib/marca";
import { runtimeEnv } from "@/lib/server/runtime";

// Espaço Oikos: empresa contratante que usa a plataforma com a marca própria dela.
//
// O acesso do administrador é uma conta de empresa comum — mesmo login, mesma sessão,
// mesmo bloqueio de tentativas, mesma auditoria. O que ele tem de diferente é só nascer
// sozinho: a primeira tentativa de entrada com este login cria a empresa, a conta e o
// vínculo de dono. Depois disso nada aqui é consultado de novo: se a senha for trocada
// pelo menu da conta, vale a nova, e a deste arquivo deixa de abrir.

export const OIKOS_ADMIN_LOGIN = "oikos@admin";
export const OIKOS_ADMIN_USER_ID = "oikos-admin";
export const OIKOS_ORGANIZATION_NAME = "Oikos";
const OIKOS_ORGANIZATION_SLUG = "oikos-ecossistema";
const OIKOS_ADMIN_NAME = "Administrador Oikos";
// Só o hash fica no código (PBKDF2-SHA256, 100.000 iterações). OIKOS_ADMIN_PASSWORD_HASH
// no ambiente substitui este valor antes do primeiro acesso.
const OIKOS_ADMIN_PASSWORD_HASH = "pbkdf2-sha256:100000:A2FFHoWH1fgNPTB2IvQM6g:_TI3nFLJ_rySiyRPxRyEFxAaLfmnjEBi38h4qxLE4Pc";

export function isOikosAdminLogin(login: string) {
  return login.trim().toLowerCase() === OIKOS_ADMIN_LOGIN;
}

/**
 * Cria, uma única vez, a empresa Oikos, a conta do administrador e o vínculo de dono.
 * Tudo com INSERT OR IGNORE / ON CONFLICT DO NOTHING: rodar de novo não muda senha,
 * papel nem nada que o próprio dono tenha alterado.
 */
export async function ensureOikosAccess(db: D1Database, now = Date.now()) {
  const existing = await db.prepare("SELECT user_id FROM user_credentials WHERE email = ?1")
    .bind(OIKOS_ADMIN_LOGIN).first<{ user_id: string }>();
  if (existing) return false;
  const passwordHash = runtimeEnv().OIKOS_ADMIN_PASSWORD_HASH?.trim() || OIKOS_ADMIN_PASSWORD_HASH;
  const memberId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug, timezone, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'America/Sao_Paulo', ?4, ?4)`,
    ).bind(OIKOS_ORGANIZATION_ID, OIKOS_ORGANIZATION_NAME, OIKOS_ORGANIZATION_SLUG, now),
    db.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
      .bind(OIKOS_ADMIN_USER_ID, OIKOS_ADMIN_LOGIN, OIKOS_ADMIN_NAME, now),
    db.prepare(
      `INSERT INTO user_credentials (user_id, email, password_hash, display_name, active, password_updated_at, created_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5) ON CONFLICT DO NOTHING`,
    ).bind(OIKOS_ADMIN_USER_ID, OIKOS_ADMIN_LOGIN, passwordHash, OIKOS_ADMIN_NAME, now),
    db.prepare(
      `INSERT OR IGNORE INTO organization_members (id, organization_id, user_id, role, created_at)
       VALUES (?1, ?2, ?3, 'owner', ?4)`,
    ).bind(memberId, OIKOS_ORGANIZATION_ID, OIKOS_ADMIN_USER_ID, now),
    db.prepare(
      `INSERT INTO members (
        id, organization_id, external_user_id, name, email, role,
        permissions_json, weekly_capacity_minutes, active, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'owner', ?6, 2400, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(organization_id, external_user_id) DO NOTHING`,
    ).bind(memberId, OIKOS_ORGANIZATION_ID, OIKOS_ADMIN_USER_ID, OIKOS_ADMIN_NAME, OIKOS_ADMIN_LOGIN, JSON.stringify(permissionsForRole("owner"))),
    db.prepare(
      `INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?1, ?2, ?3, 'organization.created', 'organization', ?2, '{"origem":"acesso_oikos"}', ?4)`,
    ).bind(crypto.randomUUID(), OIKOS_ORGANIZATION_ID, OIKOS_ADMIN_USER_ID, now),
  ]);
  return true;
}
