import { getDb } from "@/db";
import { requireAuth } from "@/lib/auth/session";
import { assertCan } from "@/lib/auth/roles";
import { createClient, listClients } from "@/lib/data/clients";
import { createClientSchema, listClientsQuerySchema } from "@/lib/domain/schemas";
import { handleRoute, parseJsonBody, parseSearchParams } from "@/lib/server/api";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "client:read");

    const query = parseSearchParams(request, listClientsQuerySchema);
    if (!query.ok) return query.response;

    // A organização vem da sessão. Não existe caminho para o cliente escolhê-la.
    const result = await listClients(getDb(), auth.active.organizationId, query.data);
    return Response.json(result);
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "client:write");

    const body = await parseJsonBody(request, createClientSchema);
    if (!body.ok) return body.response;

    const db = getDb();
    const created = await createClient(db, auth.active.organizationId, body.data);

    await recordAudit(db, {
      organizationId: auth.active.organizationId,
      actorMemberId: auth.active.memberId,
      entity: "client",
      entityId: created.id,
      action: "create",
      changes: { name: { from: null, to: created.name } },
    });

    return Response.json({ client: created }, { status: 201 });
  });
}
