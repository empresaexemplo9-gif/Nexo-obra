import { getDatabase } from "@/db";
import { ApiError } from "@/lib/server/backend";

export type AccessRule = { subject: string; state: string; until: number | null; reason: string; revision: number };
export function ruleDenies(rule: AccessRule, now = Date.now()) {
  return rule.state === "blocked" || rule.state === "removed" || (rule.state === "suspended" && (rule.until === null || rule.until > now));
}

// Every request checks current rules; a previously issued session cannot bypass a block.
export async function assertPlatformAccess(organizationId: string, email: string, userId?: string, checkBilling = false) {
  const db = getDatabase();
  const rules = await db.prepare(`SELECT r.* FROM platform_access_rules r WHERE r.organization_id = ?1
    AND (r.subject = '*' OR r.subject = ?2 OR r.subject IN
      (SELECT lower(email) FROM members WHERE organization_id = ?1 AND external_user_id = ?3
       UNION SELECT lower(email) FROM client_portal_access WHERE organization_id = ?1 AND external_user_id = ?3))`)
    .bind(organizationId, email.trim().toLowerCase(), userId ?? "").all<AccessRule>();
  if (rules.results.some((rule) => ruleDenies(rule))) throw new ApiError(403, "platform_access_blocked", "Este acesso está bloqueado. Entre em contato com o administrador.");
  if (checkBilling) {
    const activation = await db.prepare("SELECT status FROM drap_activations WHERE organization_id = ?1").bind(organizationId).first<{ status: string }>();
    if (activation && activation.status !== "active") throw new ApiError(403, "subscription_inactive", "A ativação desta empresa depende da confirmação no Drap Empresa.");
  }
}

export function platformAudit(db: D1Database, organizationId: string, actor: string, action: string, subject: string, metadata: object = {}) {
  return db.prepare(`INSERT INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?1, ?2, ?3, ?4, 'platform_access', ?5, ?6, ?7)`)
    .bind(crypto.randomUUID(), organizationId, actor, action, subject, JSON.stringify(metadata), Date.now());
}
