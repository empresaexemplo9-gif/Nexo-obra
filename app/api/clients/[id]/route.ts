import { getDb } from "@/db";
import { assertCan } from "@/lib/auth/roles";
import { requireAuth } from "@/lib/auth/session";
import { deleteClient, getClient, updateClient } from "@/lib/data/clients";
import { updateClientSchema } from "@/lib/domain/schemas";
import { apiError, handleRoute, parseJsonBody } from "@/lib/server/api";
import { diffChanges, recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Um cliente de outra empresa responde 404, nunca 403.
 *
 * A diferença importa: 403 confirmaria que o registro existe em algum lugar, o
 * que já é informação vazada. Do ponto de vista desta organização, ele não existe.
 */
export async function GET(_request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "client:read");

    const { id } = await context.params;
    const client = await getClient(getDb(), auth.active.organizationId, id);
    if (!client) return apiError(404, "not_found", "Cliente não encontrado.");

    return Response.json({ client });
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "client:write");

    const { id } = await context.params;
    const body = await parseJsonBody(request, updateClientSchema);
    if (!body.ok) return body.response;

    const db = getDb();
    const before = await getClient(db, auth.active.organizationId, id);
    if (!before) return apiError(404, "not_found", "Cliente não encontrado.");

    const updated = await updateClient(db, auth.active.organizationId, id, body.data);
    if (!updated) return apiError(404, "not_found", "Cliente não encontrado.");

    await recordAudit(db, {
      organizationId: auth.active.organizationId,
      actorMemberId: auth.active.memberId,
      entity: "client",
      entityId: id,
      action: "update",
      changes: diffChanges(before, body.data),
    });

    return Response.json({ client: updated });
  });
}

export async function DELETE(_request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "client:write");

    const { id } = await context.params;
    const db = getDb();
    const result = await deleteClient(db, auth.active.organizationId, id);

    if (!result.deleted) {
      if (result.reason === "has_projects") {
        return apiError(
          409,
          "conflict",
          "Este cliente tem projetos vinculados. Desvincule ou remova os projetos primeiro.",
        );
      }
      return apiError(404, "not_found", "Cliente não encontrado.");
    }

    await recordAudit(db, {
      organizationId: auth.active.organizationId,
      actorMemberId: auth.active.memberId,
      entity: "client",
      entityId: id,
      action: "delete",
    });

    return new Response(null, { status: 204 });
  });
}
