import { z } from "zod";

import { apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import {
  clearSuperAdminSessionCookie,
  rejectCrossSiteMutation,
  requireSuperAdmin,
  signInSuperAdmin,
} from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(200),
});

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
    const session = await signInSuperAdmin(request, parsed.data.email, parsed.data.password);
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
