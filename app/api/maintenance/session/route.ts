import { z } from "zod";

import { getDatabase } from "@/db";
import { permissionsForRole } from "@/lib/permissions";
import { ApiError, apiRoute, jsonBody, organizationSelectionCookie, validationError } from "@/lib/server/backend";
import {
  clearMaintenanceSessionCookie,
  createMaintenanceSessionCookie,
  readMaintenanceIdentity,
  MAINTENANCE_ORGANIZATION_ID,
  verifyMaintenanceCredentials,
} from "@/lib/server/maintenance";
import { loginFingerprint, rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const credentialsSchema = z.object({ email: z.string().trim().email().max(160), password: z.string().min(1).max(200) });
const MEMBER_ID = "00000000-0000-4000-9000-000000000002";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function GET(request: Request) {
  return apiRoute(async () => {
    const identity = await readMaintenanceIdentity(request);
    if (!identity) throw new ApiError(401, "maintenance_sign_in_required", "Entre com o acesso de manutenção.");
    return Response.json({ authenticated: true, email: identity.email, expiresAt: identity.expiresAt });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const parsed = credentialsSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const db = getDatabase();
    const fingerprint = `maintenance:${await loginFingerprint(request)}`;
    const now = Date.now();
    const attempt = await db.prepare("SELECT failed_count, window_started_at, locked_until FROM superadmin_login_attempts WHERE fingerprint = ?1")
      .bind(fingerprint).first<{ failed_count: number; window_started_at: number; locked_until: number }>();
    if (attempt && attempt.locked_until > now) throw new ApiError(429, "maintenance_login_locked", "Muitas tentativas. Aguarde 15 minutos.");

    if (!await verifyMaintenanceCredentials(parsed.data.email, parsed.data.password)) {
      const withinWindow = attempt && now - attempt.window_started_at < WINDOW_MS;
      const failedCount = withinWindow ? attempt.failed_count + 1 : 1;
      const lockedUntil = failedCount >= MAX_ATTEMPTS ? now + WINDOW_MS : 0;
      await db.prepare(
        `INSERT INTO superadmin_login_attempts (fingerprint, failed_count, window_started_at, locked_until, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(fingerprint) DO UPDATE SET
         failed_count = excluded.failed_count, window_started_at = excluded.window_started_at,
         locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
      ).bind(fingerprint, failedCount, withinWindow ? attempt.window_started_at : now, lockedUntil, now).run();
      throw new ApiError(401, "invalid_maintenance_credentials", "Usuário ou senha inválidos.");
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const existingUser = await db.prepare("SELECT id FROM users WHERE lower(email) = ?1 LIMIT 1")
      .bind(normalizedEmail).first<{ id: string }>();
    const userId = existingUser?.id ?? "nexo-maintenance-admin";
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
        .bind(userId, normalizedEmail, "Administrador de manutenção", now),
      db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug, timezone, created_at, updated_at) VALUES (?1, 'Ambiente de manutenção', 'ambiente-de-manutencao', 'America/Sao_Paulo', ?2, ?2)")
        .bind(MAINTENANCE_ORGANIZATION_ID, now),
      db.prepare("INSERT OR IGNORE INTO organization_members (id, organization_id, user_id, role, created_at) VALUES (?1, ?2, ?3, 'admin', ?4)")
        .bind(MEMBER_ID, MAINTENANCE_ORGANIZATION_ID, userId, now),
      db.prepare(
        `INSERT INTO members (id, organization_id, external_user_id, name, email, role, permissions_json,
         weekly_capacity_minutes, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'Administrador de manutenção', ?4, 'admin', ?5, 2400, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET external_user_id = excluded.external_user_id, email = excluded.email,
         role = 'admin', permissions_json = excluded.permissions_json, active = 1, updated_at = CURRENT_TIMESTAMP`,
      ).bind(MEMBER_ID, MAINTENANCE_ORGANIZATION_ID, userId, normalizedEmail, JSON.stringify(permissionsForRole("admin"))),
      db.prepare("DELETE FROM superadmin_login_attempts WHERE fingerprint = ?1").bind(fingerprint),
    ]);
    const session = await createMaintenanceSessionCookie();
    const headers = new Headers();
    headers.append("Set-Cookie", session.cookie);
    headers.append("Set-Cookie", organizationSelectionCookie(MAINTENANCE_ORGANIZATION_ID));
    return Response.json(
      { authenticated: true, email: normalizedEmail, expiresAt: session.expiresAt, organizationId: MAINTENANCE_ORGANIZATION_ID },
      { headers },
    );
  });
}

export async function DELETE(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    return Response.json({ authenticated: false }, { headers: { "Set-Cookie": clearMaintenanceSessionCookie() } });
  });
}
