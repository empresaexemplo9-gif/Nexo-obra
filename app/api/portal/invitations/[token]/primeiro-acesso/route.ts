import { z } from "zod";

import { getDatabase } from "@/db";
import { ApiError, jsonBody, validationError } from "@/lib/server/backend";
import { assertPasswordStrength, createSessionCookie, credentialExists, hashPassword, saveCredentialStatement } from "@/lib/server/auth";
import { invitationTokenHash } from "@/lib/server/invitations";
import { assertPlatformAccess } from "@/lib/server/platform-access";
import { checkPortalOrigin, portalHeaders, portalRoute } from "@/lib/server/portal";
import { requestEvidenceHashes } from "@/lib/server/terms";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string }> };

const schema = z.object({
  password: z.string().min(1).max(200),
  accepted: z.literal(true),
  version: z.literal(CURRENT_TERMS_VERSION),
}).strict();

type Access = { id: string; organization_id: string; email: string; name: string; status: string; expires_at: number; revision: number; token_hash: string };

/**
 * Primeiro acesso do cliente pelo link do convite: cria a senha, ativa o acesso à obra e
 * registra o aceite dos termos, numa ida só. Antes o portal exigia estar logado para abrir o
 * convite, e não havia onde criar a senha — o cliente novo não tinha como entrar.
 *
 * Só cria senha para e-mail que ainda não tem conta: quem emite o convite tem o link, e
 * sobrescrever a senha de uma conta existente seria entregar a conta de outra pessoa.
 */
export async function POST(request: Request, { params }: Params) {
  return portalRoute(async () => {
    checkPortalOrigin(request);
    const { token } = await params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(404, "not_found", "Convite não encontrado.");
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    assertPasswordStrength(parsed.data.password);

    const db = getDatabase();
    const access = await db.prepare("SELECT id, organization_id, email, name, status, expires_at, revision, token_hash FROM client_portal_access WHERE token_hash = ?1")
      .bind(await invitationTokenHash(token)).first<Access>();
    if (!access) throw new ApiError(404, "not_found", "Convite não encontrado.");
    if (access.status === "revoked") throw new ApiError(410, "portal_invitation_revoked", "Este convite foi revogado.");
    if (access.status !== "pending") throw new ApiError(409, "portal_invitation_used", "Este convite já foi usado. Entre com o seu e-mail e a sua senha.");
    if (access.expires_at <= Date.now()) throw new ApiError(410, "portal_invitation_expired", "Este convite expirou. Solicite um novo à empresa.");
    const email = access.email.trim().toLowerCase();
    if (await credentialExists(email)) {
      throw new ApiError(409, "account_exists", `O e-mail ${email} já tem acesso à H.OIKOS. Entre com a sua senha e abra o convite de novo.`);
    }

    const user = { id: crypto.randomUUID(), email, displayName: access.name || email.split("@")[0] };
    await assertPlatformAccess(access.organization_id, user.email, user.id, false);
    const now = Date.now();
    const passwordHash = await hashPassword(parsed.data.password);
    const evidence = await requestEvidenceHashes(request);

    // Reivindica o convite antes de tudo: dois envios simultâneos não criam duas contas.
    const claimed = await db.prepare(`UPDATE client_portal_access SET external_user_id = ?1, status = 'active', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?2 AND status = 'pending' AND revision = ?3 AND token_hash = ?4 AND expires_at > ?5`)
      .bind(user.id, access.id, access.revision, access.token_hash, now).run();
    if (!claimed.meta?.changes) throw new ApiError(409, "portal_invitation_changed", "Este convite mudou. Abra o link de novo.");

    const devolver = () => db.prepare(`UPDATE client_portal_access SET external_user_id = NULL, status = 'pending', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND external_user_id = ?2`).bind(access.id, user.id).run();
    try {
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)").bind(user.id, user.email, user.displayName, now),
        saveCredentialStatement(db, user, passwordHash, now),
        db.prepare(`INSERT INTO client_portal_acceptances (id, organization_id, access_id, external_user_id, terms_version, ip_hash, user_agent_hash, accepted_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(access_id, external_user_id, terms_version) DO NOTHING`)
          .bind(crypto.randomUUID(), access.organization_id, access.id, user.id, CURRENT_TERMS_VERSION, evidence.ipHash, evidence.userAgentHash, now),
      ]);
    } catch (error) {
      await devolver();
      throw error;
    }
    // Outra aba pode ter criado a conta deste e-mail no mesmo instante: a senha que vale é a
    // que ficou gravada. Se não foi esta, o acesso volta a pendente e a pessoa entra com a dela.
    const gravada = await db.prepare("SELECT user_id FROM user_credentials WHERE email = ?1").bind(user.email).first<{ user_id: string }>();
    if (gravada?.user_id !== user.id) {
      await devolver();
      throw new ApiError(409, "account_exists", `O e-mail ${email} já tem acesso à H.OIKOS. Entre com a sua senha e abra o convite de novo.`);
    }
    const session = await createSessionCookie(user);
    return Response.json({ accepted: true, accessId: access.id }, { status: 201, headers: { ...portalHeaders, "Set-Cookie": session.cookie } });
  });
}
