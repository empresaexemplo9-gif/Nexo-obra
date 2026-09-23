import { callOperationalDrap, drapOperationalRoute, operationalDrapBody, operationalDrapContext, requireChaveIdempotencia } from "@/lib/server/drap-operational";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, "view");
    const { id } = await params;
    return callOperationalDrap(connection.external_company_id, `/api/v1/lancamentos/${encodeURIComponent(id)}`);
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, "edit");
    const idempotencyKey = requireChaveIdempotencia(request);
    const { id } = await params;
    const body = await operationalDrapBody(request);
    return callOperationalDrap(connection.external_company_id, `/api/v1/lancamentos/${encodeURIComponent(id)}`, { method: "PATCH", body, idempotencyKey });
  });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, "edit");
    const idempotencyKey = requireChaveIdempotencia(request);
    const { id } = await params;
    return callOperationalDrap(connection.external_company_id, `/api/v1/lancamentos/${encodeURIComponent(id)}`, { method: "DELETE", idempotencyKey });
  });
}
