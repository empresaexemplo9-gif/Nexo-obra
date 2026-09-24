import { z } from "zod";

import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { clearSessionCookie, createSessionCookie, readSessionUser, signIn } from "@/lib/server/auth";
import { clearSuperAdminFailures, isSuperAdminEmail, rejectCrossSiteMutation, signInSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(200),
}).strict();

export async function GET(request: Request) {
  return apiRoute(async () => {
    const user = await readSessionUser(request);
    return Response.json(
      user ? { authenticated: true, user } : { authenticated: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const parsed = credentialsSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const { email, password } = parsed.data;
    // Um só lugar para entrar. O que leva ao painel da plataforma são as credenciais do
    // superadministrador; qualquer outra combinação é conta de empresa. O mesmo e-mail pode
    // ter as duas: senha da plataforma abre o painel, senha da empresa abre a empresa.
    const superadmin = await isSuperAdminEmail(email);
    if (superadmin) {
      try {
        const session = await signInSuperAdmin(request, email, password);
        return Response.json(
          { authenticated: true, scope: "superadmin", redirectTo: "/superadmin", expiresAt: session.expiresAt },
          { headers: { "Set-Cookie": session.cookie, "Cache-Control": "private, no-store" } },
        );
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "invalid_superadmin_credentials")) throw error;
      }
    }
    const user = await signIn(request, email, password);
    if (superadmin) await clearSuperAdminFailures(request);
    const session = await createSessionCookie(user);
    return Response.json(
      { authenticated: true, scope: "account", redirectTo: "/", user, expiresAt: session.expiresAt },
      { headers: { "Set-Cookie": session.cookie, "Cache-Control": "private, no-store" } },
    );
  });
}

export async function DELETE(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    return Response.json({ authenticated: false }, { headers: { "Set-Cookie": clearSessionCookie() } });
  });
}
