import { z } from "zod";
import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { checkPortalOrigin } from "@/lib/server/portal";
import { activationConfigured, activationFor, sendActivation } from "@/lib/server/activation";
import { assertPlatformAccess, platformAudit } from "@/lib/server/platform-access";
import { createInvitationToken, invitationTokenHash } from "@/lib/server/invitations";
import { permissionsForRole } from "@/lib/permissions";
import { MAINTENANCE_ORGANIZATION_ID } from "@/lib/server/maintenance";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const id = z.string().uuid();
const subject = z.union([z.literal("*"), z.string().trim().email().max(160).transform((v) => v.toLowerCase())]);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("access"), organizationId: id, subject, state: z.enum(["active", "suspended", "blocked", "removed"]),
    until: z.number().int().nullable(), reason: z.string().trim().min(3).max(500), revision: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal("partner"), organizationId: id, email: z.string().trim().email().max(160).transform((v) => v.toLowerCase()) }).strict(),
  z.object({ action: z.literal("enroll"), organizationId: id, companyId: z.string().trim().min(1).max(120), planId: z.string().trim().min(1).max(120), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("send"), organizationId: id }).strict(),
]);
async function organization(organizationId: string) {
  if (!id.safeParse(organizationId).success) throw new ApiError(400, "invalid_organization", "Selecione uma empresa.");
  if (organizationId === MAINTENANCE_ORGANIZATION_ID) throw new ApiError(403, "maintenance_reserved", "O ambiente de manutenção é reservado.");
  if (!await getDatabase().prepare("SELECT id FROM organizations WHERE id = ?1").bind(organizationId).first()) throw new ApiError(404, "organization_not_found", "Empresa não encontrada.");
}
export async function GET(request: Request) {
  const response = await apiRoute(async () => {
    await requireSuperAdmin(request);
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? ""; await organization(organizationId);
    const db = getDatabase();
    const [members, rules, activation, history, targets] = await Promise.all([
      db.prepare("SELECT id, name, email, role, active FROM members WHERE organization_id = ?1 AND role != 'superadmin' ORDER BY name").bind(organizationId).all(),
      db.prepare("SELECT subject, state, until, reason, revision FROM platform_access_rules WHERE organization_id = ?1").bind(organizationId).all(),
      activationFor(organizationId),
      db.prepare(`SELECT action, entity_id, actor_user_id, metadata_json, created_at FROM platform_audit_events
        WHERE organization_id = ?1 AND (action LIKE 'platform.%' OR action LIKE 'drap.activation%') ORDER BY created_at DESC LIMIT 50`).bind(organizationId).all(),
      db.prepare(`SELECT lower(email) email FROM members WHERE organization_id = ?1 AND role != 'superadmin'
        UNION SELECT lower(email) FROM client_portal_access WHERE organization_id = ?1
        UNION SELECT lower(email) FROM organization_invitations WHERE organization_id = ?1`).bind(organizationId).all(),
    ]);
    return json({ members: members.results, rules: rules.results, activation, history: history.results, targets: targets.results, configured: activationConfigured() });
  });
  response.headers.set("Cache-Control", "private, no-store"); return response;
}
export async function POST(request: Request) {
  const response = await apiRoute(async () => {
    checkPortalOrigin(request); const admin = await requireSuperAdmin(request);
    const parsed = schema.safeParse(await jsonBody(request)); if (!parsed.success) throw validationError(parsed.error.flatten());
    const data = parsed.data; await organization(data.organizationId); const db = getDatabase();
    if (data.action === "access") {
      if (data.state === "suspended" && (!data.until || data.until <= Date.now() || data.until > Date.now() + 366 * 86400000)) throw new ApiError(400, "invalid_expiry", "Escolha o término do bloqueio, dentro de um ano.");
      if (data.state !== "suspended" && data.until !== null) throw new ApiError(400, "invalid_expiry", "Somente o bloqueio temporário recebe uma data.");
      const [result] = await db.batch([
        db.prepare(`INSERT INTO platform_access_rules (organization_id, subject, state, until, reason, revision, updated_at)
          SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6 WHERE ?7 = 0 OR EXISTS
            (SELECT 1 FROM platform_access_rules WHERE organization_id = ?1 AND subject = ?2)
          ON CONFLICT(organization_id, subject) DO UPDATE SET state = excluded.state, until = excluded.until,
            reason = excluded.reason, revision = platform_access_rules.revision + 1, updated_at = excluded.updated_at
          WHERE platform_access_rules.revision = ?7 RETURNING revision`)
          .bind(data.organizationId, data.subject, data.state, data.until, data.reason, Date.now(), data.revision),
        db.prepare(`INSERT INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
          SELECT ?1, ?2, ?3, 'platform.access_changed', 'platform_access', ?4, ?5, ?6 WHERE changes() > 0`)
          .bind(crypto.randomUUID(), data.organizationId, admin.email, data.subject, JSON.stringify({ state: data.state, until: data.until, reason: data.reason }), Date.now()),
      ]);
      if (!result.results.length) throw new ApiError(409, "access_conflict", "O acesso mudou. Atualize a lista antes de salvar.");
      return json({ saved: true });
    }
    if (data.action === "partner") {
      await assertPlatformAccess(data.organizationId, data.email, undefined, false);
      if (await db.prepare("SELECT id FROM members WHERE organization_id = ?1 AND lower(email) = ?2").bind(data.organizationId, data.email).first()) throw new ApiError(409, "member_exists", "Este e-mail já pertence à empresa. Gerencie o acesso existente.");
      if (await db.prepare(`SELECT id FROM organization_invitations WHERE organization_id = ?1 AND lower(email) = ?2
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?3`).bind(data.organizationId, data.email, Date.now()).first()) throw new ApiError(409, "invitation_exists", "Já existe um convite pendente para este e-mail.");
      const token = createInvitationToken(); const invitationId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO organization_invitations (id, organization_id, email, role, permissions_json, token_hash, invited_by_email, expires_at, created_at)
          VALUES (?1, ?2, ?3, 'partner', ?4, ?5, ?6, ?7, ?8)`)
          .bind(invitationId, data.organizationId, data.email, JSON.stringify(permissionsForRole("partner")), await invitationTokenHash(token), admin.email, Date.now() + 7 * 86400000, Date.now()),
        platformAudit(db, data.organizationId, admin.email, "platform.partner_invited", data.email),
      ]);
      return json({ invitationPath: `/convite/${token}` }, 201);
    }
    if (data.action === "enroll") {
      const existing = await activationFor(data.organizationId);
      if (existing) throw new ApiError(409, "activation_exists", "Esta empresa já possui um vínculo. Alterações de assinatura devem ser feitas no Empresa.");
      try {
        await db.batch([
          db.prepare(`INSERT INTO drap_activations (organization_id, company_id, plan_id, request_key, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
            .bind(data.organizationId, data.companyId, data.planId, crypto.randomUUID(), Date.now()),
          platformAudit(db, data.organizationId, admin.email, "drap.activation_enrolled", data.organizationId, { companyId: data.companyId, planId: data.planId, multiplierBps: 15000 }),
        ]);
      } catch (error) {
        if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "company_already_linked", "A empresa Drap já está vinculada a uma ativação.");
        throw error;
      }
      return json({ enrolled: true }, 201);
    }
    const activation = await activationFor(data.organizationId);
    if (!activation) throw new ApiError(404, "activation_missing", "Vincule a assinatura primeiro.");
    const result = await sendActivation(activation);
    await platformAudit(db, data.organizationId, admin.email, "drap.activation_requested", data.organizationId).run();
    return json(result);
  });
  response.headers.set("Cache-Control", "private, no-store"); return response;
}
