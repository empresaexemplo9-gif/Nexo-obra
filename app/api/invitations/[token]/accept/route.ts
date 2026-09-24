import { getDatabase } from "@/db";
import { assertPlatformAccess } from "@/lib/server/platform-access";
import {
  ApiError,
  apiRoute,
  authenticatedIdentity,
  jsonBody,
  organizationSelectionCookie,
  validationError,
} from "@/lib/server/backend";
import { invitationTokenHash, validateInvitationState } from "@/lib/server/invitations";
import { parseStoredPermissions } from "@/lib/permissions";
import { requestEvidenceHashes } from "@/lib/server/terms";
import {
  assertPasswordStrength, createSessionCookie, credentialExists, hashPassword, saveCredentialStatement,
} from "@/lib/server/auth";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { z } from "zod";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };
type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  permissions_json: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
};

// Sem a borda autenticada externa, o convite é o lugar onde a pessoa passa a existir:
// ela confirma o próprio e-mail e escolhe a senha. Quem já tem sessão aberta só aceita.
const acceptanceSchema = z.object({
  acceptTerms: z.literal(true),
  password: z.string().min(1).max(200).optional(),
}).strict();

// A identidade já existente, se houver: sessão própria, borda confiável ou acesso
// reservado. Devolve nulo quando ninguém está autenticado — que é o caso do primeiro
// acesso, em que o convite é a única coisa que sabe quem foi convidado.
async function currentIdentity(request: Request) {
  try {
    return await authenticatedIdentity(request);
  } catch {
    return null;
  }
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const existing = await currentIdentity(request);
    if (existing?.scope === "maintenance") throw new ApiError(403, "maintenance_scope", "O acesso de manutenção permanece isolado do ambiente dos clientes.");
    if (existing?.scope === "superadmin") throw new ApiError(403, "superadmin_scope", "O superadministrador já opera todas as empresas. Saia do painel para aceitar um convite com sua conta pessoal.");
    const parsed = acceptanceSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    // Quem ainda não tem identidade nenhuma cria a senha agora; é o primeiro acesso.
    if (!existing && !parsed.data.password) {
      throw new ApiError(400, "password_required", "Crie uma senha para o seu acesso.");
    }
    // Com sessão aberta a senha não é tocada: aceitar convite não é trocar senha.
    const newPassword = existing ? undefined : parsed.data.password;
    if (newPassword) assertPasswordStrength(newPassword);
    const { token } = await route.params;
    if (token.length < 32 || token.length > 100) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    const db = getDatabase();
    const tokenHash = await invitationTokenHash(token);
    const invitation = await db.prepare(
      `SELECT id, organization_id, email, role, permissions_json, expires_at, accepted_at, revoked_at
       FROM organization_invitations WHERE token_hash = ?1`,
    ).bind(tokenHash).first<InvitationRow>();
    if (!invitation) throw new ApiError(404, "invitation_not_found", "Convite não encontrado.");
    validateInvitationState(invitation);
    // Quem já está autenticado precisa ser a pessoa convidada. Quem não está passa a ser.
    if (existing && existing.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      throw new ApiError(403, "invitation_email_mismatch", `Entre com o e-mail ${invitation.email} para aceitar este convite.`);
    }
    // O convite só cria senha para quem ainda não tem. Sem esta trava, quem emitiu o convite
    // (e portanto tem o link) abria o link deslogado, escolhia uma senha e tomava a conta de
    // quem já usava a plataforma em outra empresa.
    if (!existing && await credentialExists(invitation.email)) {
      throw new ApiError(409, "account_exists", `O e-mail ${invitation.email} já tem acesso à H.OIKOS. Entre com a sua senha e abra o convite de novo para aceitar.`);
    }
    const identity = existing ?? {
      id: crypto.randomUUID(),
      email: invitation.email,
      displayName: invitation.email.split("@")[0],
    };
    await assertPlatformAccess(invitation.organization_id, identity.email, identity.id, false);

    const now = Date.now();
    const legacyUser = await db.prepare("SELECT id FROM users WHERE id = ?1 OR lower(email) = lower(?2) LIMIT 1")
      .bind(identity.id, identity.email).first<{ id: string }>();
    const userId = legacyUser?.id ?? identity.id;
    const existingMember = await db.prepare(
      `SELECT id, role FROM members
       WHERE organization_id = ?1 AND role != 'superadmin'
         AND (external_user_id = ?2 OR lower(email) = lower(?3)) LIMIT 1`,
    ).bind(invitation.organization_id, identity.id, identity.email).first<{ id: string; role: string }>();
    const memberId = existingMember?.id ?? crypto.randomUUID();
    const role = existingMember?.role === "owner" ? "owner" : invitation.role;
    const permissions = parseStoredPermissions(invitation.permissions_json, role);
    const evidence = await requestEvidenceHashes(request);

    const passwordHash = newPassword ? await hashPassword(newPassword) : null;

    // Reivindica o convite antes de tudo: dois aceites simultâneos criavam dois membros
    // para o mesmo e-mail, porque o UPDATE no meio do lote não impedia o resto dele.
    const claimed = await db.prepare(
      `UPDATE organization_invitations SET accepted_at = ?1, accepted_by_user_id = ?2
       WHERE id = ?3 AND accepted_at IS NULL AND revoked_at IS NULL`,
    ).bind(now, identity.id, invitation.id).run();
    if (!claimed.meta?.changes) throw new ApiError(409, "invitation_already_accepted", "Este convite já foi aceito.");

    try {
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)`,
      ).bind(userId, identity.email, identity.displayName, now),
      ...(passwordHash
        ? [saveCredentialStatement(db, { id: userId, email: identity.email, displayName: identity.displayName }, passwordHash, now)]
        : []),
      existingMember
        ? db.prepare(
          `UPDATE members SET external_user_id = ?1, name = ?2, email = ?3, role = ?4,
           permissions_json = ?5, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?6 AND organization_id = ?7`,
        ).bind(userId, identity.displayName, identity.email, role, JSON.stringify(permissions), memberId, invitation.organization_id)
        : db.prepare(
          `INSERT INTO members (
            id, organization_id, external_user_id, name, email, role,
            permissions_json, weekly_capacity_minutes, active, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 2400, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ).bind(memberId, invitation.organization_id, userId, identity.displayName, identity.email, role, JSON.stringify(permissions)),
      db.prepare(
        `INSERT INTO organization_members (id, organization_id, user_id, role, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(organization_id, user_id) DO UPDATE SET role = CASE
           WHEN organization_members.role = 'owner' THEN 'owner' ELSE excluded.role END`,
      ).bind(memberId, invitation.organization_id, userId, role, now),
      db.prepare(
        `INSERT INTO terms_acceptances (
          id, organization_id, external_user_id, email, terms_version,
          invitation_id, ip_hash, user_agent_hash, accepted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(organization_id, external_user_id, terms_version) DO UPDATE SET
          email = excluded.email, invitation_id = excluded.invitation_id,
          ip_hash = excluded.ip_hash, user_agent_hash = excluded.user_agent_hash,
          accepted_at = excluded.accepted_at`,
      ).bind(crypto.randomUUID(), invitation.organization_id, identity.id, identity.email, CURRENT_TERMS_VERSION, invitation.id, evidence.ipHash, evidence.userAgentHash, now),
      db.prepare(
        `INSERT INTO audit_events (
          id, organization_id, actor_user_id, action, entity_type, entity_id,
          metadata_json, created_at
        ) VALUES (?1, ?2, ?3, 'invitation.accepted', 'invitation', ?4, ?5, ?6)`,
      ).bind(crypto.randomUUID(), invitation.organization_id, userId, invitation.id, JSON.stringify({ role }), now),
    ]);
    } catch (error) {
      // O lote falhou: devolve o convite para que a pessoa possa tentar de novo.
      await db.prepare("UPDATE organization_invitations SET accepted_at = NULL, accepted_by_user_id = NULL WHERE id = ?1 AND accepted_at = ?2")
        .bind(invitation.id, now).run();
      throw error;
    }

    // Aceitar já abre a sessão: sem isso a pessoa criaria a senha e continuaria de fora.
    const headers = new Headers();
    headers.append("Set-Cookie", organizationSelectionCookie(invitation.organization_id));
    if (passwordHash) {
      const opened = await createSessionCookie({ id: userId, email: identity.email, displayName: identity.displayName });
      headers.append("Set-Cookie", opened.cookie);
    }
    return Response.json({ accepted: true, organizationId: invitation.organization_id, role }, { headers });
  });
}
