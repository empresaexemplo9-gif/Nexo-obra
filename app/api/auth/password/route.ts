import { z } from "zod";

import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { changeOwnPassword, createSessionCookie, readSessionUser, sessionPredatesPassword } from "@/lib/server/auth";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
}).strict();

// Troca da própria senha. Só para conta com senha: o superadministrador e a manutenção
// usam credenciais do ambiente, que não mudam por aqui.
export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const session = await readSessionUser(request);
    if (!session || await sessionPredatesPassword(session)) {
      throw new ApiError(401, "sign_in_required", "Entre com sua conta para trocar a senha.");
    }
    const parsed = bodySchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    await changeOwnPassword(session, parsed.data.currentPassword, parsed.data.newPassword);
    // As outras sessões caem; esta continua com um cookie emitido depois da troca.
    const fresh = await createSessionCookie({ id: session.id, email: session.email, displayName: session.displayName });
    return Response.json({ updated: true }, { headers: { "Set-Cookie": fresh.cookie, "Cache-Control": "private, no-store" } });
  });
}
