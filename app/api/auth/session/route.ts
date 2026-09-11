import { z } from "zod";

import { apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { clearSessionCookie, createSessionCookie, readSessionUser, signIn } from "@/lib/server/auth";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

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
    const user = await signIn(request, parsed.data.email, parsed.data.password);
    const session = await createSessionCookie(user);
    return Response.json(
      { authenticated: true, user, expiresAt: session.expiresAt },
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
