import { z } from "zod";

import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";
import { STATUS_REUNIAO } from "@/lib/reunioes";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(STATUS_REUNIAO) }).strict();

// Andamento do pedido: novo → contato feito → encerrado. O pedido nunca é apagado por
// aqui; "encerrado" guarda que houve o contato.
export async function PATCH(request: Request, route: { params: Promise<{ requestId: string }> }) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    await requireSuperAdmin(request);
    const { requestId } = await route.params;
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const resultado = await getDatabase().prepare("UPDATE meeting_requests SET status = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(parsed.data.status, Date.now(), requestId).run();
    if (!resultado.meta?.changes) throw new ApiError(404, "meeting_request_not_found", "Pedido de reunião não encontrado.");
    return Response.json({ id: requestId, status: parsed.data.status });
  });
}
