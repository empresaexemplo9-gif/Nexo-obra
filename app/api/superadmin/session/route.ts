import { z } from "zod";

import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import {
  clearSuperAdminSessionCookie,
  createSuperAdminSessionCookie,
  loginFingerprint,
  rejectCrossSiteMutation,
  requireSuperAdmin,
  verifySuperAdminCredentials,
} from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(200),
});

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function GET(request: Request) {
  return apiRoute(async () => {
    const session = await requireSuperAdmin(request);
    return Response.json({ authenticated: true, ...session });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const parsed = credentialsSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);

    const db = getDatabase();
    const fingerprint = await loginFingerprint(request);
    const now = Date.now();
    const attempt = await db.prepare(
      "SELECT failed_count, window_started_at, locked_until FROM superadmin_login_attempts WHERE fingerprint = ?1",
    ).bind(fingerprint).first<{ failed_count: number; window_started_at: number; locked_until: number }>();

    if (attempt && attempt.locked_until > now) {
      throw new ApiError(429, "superadmin_login_locked", "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
    }

    if (!await verifySuperAdminCredentials(parsed.data.email, parsed.data.password)) {
      const withinWindow = attempt && now - attempt.window_started_at < WINDOW_MS;
      const failedCount = withinWindow ? attempt.failed_count + 1 : 1;
      const windowStartedAt = withinWindow ? attempt.window_started_at : now;
      const lockedUntil = failedCount >= MAX_ATTEMPTS ? now + WINDOW_MS : 0;
      await db.prepare(
        `INSERT INTO superadmin_login_attempts (fingerprint, failed_count, window_started_at, locked_until, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(fingerprint) DO UPDATE SET
           failed_count = excluded.failed_count,
           window_started_at = excluded.window_started_at,
           locked_until = excluded.locked_until,
           updated_at = excluded.updated_at`,
      ).bind(fingerprint, failedCount, windowStartedAt, lockedUntil, now).run();
      throw new ApiError(401, "invalid_superadmin_credentials", "Usuário ou senha inválidos.");
    }

    await db.prepare("DELETE FROM superadmin_login_attempts WHERE fingerprint = ?1").bind(fingerprint).run();
    const session = await createSuperAdminSessionCookie();
    return Response.json(
      { authenticated: true, email: parsed.data.email, expiresAt: session.expiresAt },
      { headers: { "Set-Cookie": session.cookie } },
    );
  });
}

export async function DELETE(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    return Response.json(
      { authenticated: false },
      { headers: { "Set-Cookie": clearSuperAdminSessionCookie() } },
    );
  });
}
