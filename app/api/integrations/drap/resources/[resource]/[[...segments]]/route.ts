import { ApiError } from "@/lib/server/backend";
import {
  callOperationalDrap,
  chaveIdempotenciaDe,
  drapOperationalRoute,
  operationalDrapBody,
  operationalDrapContext,
} from "@/lib/server/drap-operational";
import {
  isDrapResource,
  isDrapResourceWritable,
  requireDrapResourcePath,
} from "@/lib/server/drap-resources";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ resource: string; segments?: string[] }> };
type Method = "GET" | "POST" | "PATCH" | "DELETE";

function safeSegments(segments: string[] | undefined) {
  const values = segments ?? [];
  if (values.length > 8 || values.some((value) => !value || value.length > 160 || value === "." || value === "..")) {
    throw new ApiError(400, "invalid_drap_resource_path", "O caminho do recurso DRAP é inválido.");
  }
  return values.map((value) => encodeURIComponent(value));
}

async function forward(request: Request, { params }: RouteContext, method: Method) {
  return drapOperationalRoute(async () => {
    const { connection } = await operationalDrapContext(request, method === "GET" ? "view" : "edit");
    const route = await params;
    if (!isDrapResource(route.resource)) {
      throw new ApiError(404, "drap_resource_not_allowed", "Este recurso não faz parte da superfície DRAP permitida pela H.OIKOS.");
    }
    if (method !== "GET" && !isDrapResourceWritable(route.resource)) {
      throw new ApiError(405, "drap_resource_read_only", "Este recurso DRAP é somente leitura pela H.OIKOS.");
    }

    const basePath = await requireDrapResourcePath(connection.external_company_id, route.resource);
    const suffixPath = safeSegments(route.segments);
    const target = suffixPath.length ? `${basePath}/${suffixPath.join("/")}` : basePath;
    const incoming = new URL(request.url).searchParams;
    const query = incoming.size ? `?${incoming.toString()}` : "";

    if (method === "GET") {
      return callOperationalDrap(connection.external_company_id, `${target}${query}`);
    }

    const idempotencyKey = chaveIdempotenciaDe(request);
    if (!idempotencyKey) {
      throw new ApiError(400, "idempotency_key_required", "Envie uma Idempotency-Key válida para qualquer escrita financeira.");
    }
    const body = method === "DELETE" ? undefined : await operationalDrapBody(request);
    return callOperationalDrap(connection.external_company_id, `${target}${query}`, {
      method,
      body,
      idempotencyKey,
    });
  });
}

export async function GET(request: Request, context: RouteContext) {
  return forward(request, context, "GET");
}

export async function POST(request: Request, context: RouteContext) {
  return forward(request, context, "POST");
}

export async function PATCH(request: Request, context: RouteContext) {
  return forward(request, context, "PATCH");
}

export async function DELETE(request: Request, context: RouteContext) {
  return forward(request, context, "DELETE");
}
