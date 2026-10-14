import { z } from "zod";

import { apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { clearSessionCookie } from "@/lib/server/auth";
import { readPasswordReset, redeemPasswordReset } from "@/lib/server/password-reset";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };
const noStore = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const bodySchema = z.object({ password: z.string().min(1).max(200) }).strict();

export async function GET(_request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { token } = await route.params;
    return Response.json(await readPasswordReset(token), { headers: noStore });
  });
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const parsed = bodySchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const { token } = await route.params;
    const result = await redeemPasswordReset(token, parsed.data.password);
    // Quem estava com a sessão aberta neste navegador entra de novo, já com a senha nova.
    return Response.json({ updated: true, email: result.email, redirectTo: "/entrar" },
      { headers: { ...noStore, "Set-Cookie": clearSessionCookie() } });
  });
}
