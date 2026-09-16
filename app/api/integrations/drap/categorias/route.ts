import { callOperationalDrap, drapOperationalRoute, operationalDrapBody, operationalDrapContext } from "@/lib/server/drap-operational";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, "view");
    return callOperationalDrap(connection.external_company_id, "/api/v1/categorias");
  });
}

export async function POST(request: Request) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, "edit");
    const body = await operationalDrapBody(request);
    return callOperationalDrap(connection.external_company_id, "/api/v1/categorias", { method: "POST", body });
  });
}
