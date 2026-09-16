import { callOperationalDrap, drapOperationalRoute, operationalDrapBody, operationalDrapContext } from "@/lib/server/drap-operational";

export const dynamic = "force-dynamic";

const FILTERS = ["tipo", "status", "data_de", "data_ate", "limit", "offset"] as const;

export async function GET(request: Request) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, "view");
    const incoming = new URL(request.url).searchParams;
    const query = new URLSearchParams();
    for (const key of FILTERS) {
      const value = incoming.get(key);
      if (value !== null && value !== "") query.set(key, value);
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return callOperationalDrap(connection.external_company_id, `/api/v1/lancamentos${suffix}`);
  });
}

export async function POST(request: Request) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, "edit");
    const body = await operationalDrapBody(request);
    return callOperationalDrap(connection.external_company_id, "/api/v1/lancamentos", { method: "POST", body });
  });
}
