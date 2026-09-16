import { z } from "zod";

import { DrapApiError, requestDrapApi } from "@/lib/integrations/drap";
import { apiRoute, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { requireActiveDrapConnection } from "@/lib/server/drap";

const objectBodySchema = z.record(z.unknown()).refine((value) => Object.keys(value).length > 0, "Body vazio");

export async function operationalDrapContext(request: Request, access: "view" | "edit") {
  const context = await requireOrganizationContext(request);
  requireModulePermission(context, "finance", access);
  const connection = await requireActiveDrapConnection(context);
  return { context, connection };
}

export async function operationalDrapBody(request: Request) {
  const parsed = objectBodySchema.safeParse(await jsonBody(request));
  if (!parsed.success) throw validationError(parsed.error.flatten().formErrors);
  return parsed.data;
}

export function drapOperationalRoute(
  handler: () => Promise<{ data: unknown; status: number; retryAfter?: string | null }>,
) {
  return apiRoute(async () => {
    try {
      const result = await handler();
      const headers = new Headers({ "Cache-Control": "private, no-store" });
      if (result.retryAfter) headers.set("Retry-After", result.retryAfter);
      if (result.status === 204) return new Response(null, { status: 204, headers });
      return Response.json(result.data, { status: result.status, headers });
    } catch (cause) {
      if (!(cause instanceof DrapApiError)) throw cause;
      const headers = new Headers({ "Cache-Control": "private, no-store" });
      if (cause.retryAfter) headers.set("Retry-After", cause.retryAfter);

      const remote = cause.detail && typeof cause.detail === "object" ? cause.detail as Record<string, unknown> : {};
      const detail = remote.detail ?? remote.error ?? null;
      if (cause.status === 400) return Response.json({ error: "Dados rejeitados pela Drap.", code: "drap_invalid_body", detail }, { status: 400, headers });
      if (cause.status === 401) return Response.json({ error: "A credencial Drap deste tenant está inválida ou revogada.", code: "drap_credential_invalid" }, { status: 502, headers });
      if (cause.status === 403) return Response.json({ error: "Este serviço Drap não está habilitado para a empresa.", code: "drap_scope_insufficient" }, { status: 403, headers });
      if (cause.status === 404) return Response.json({ error: "O recurso não existe neste tenant Drap.", code: "drap_not_found" }, { status: 404, headers });
      if (cause.status === 409) return Response.json({ error: "A Drap recusou a operação por conflito.", code: "drap_conflict", detail }, { status: 409, headers });
      if (cause.status === 429) return Response.json({ error: "Limite de requisições da Drap atingido. Tente novamente após o intervalo informado.", code: "drap_rate_limited" }, { status: 429, headers });
      return Response.json({ error: "A Drap não conseguiu concluir a operação.", code: "drap_unavailable" }, { status: 502, headers });
    }
  });
}

export async function callOperationalDrap(
  externalCompanyId: string,
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown },
) {
  const result = await requestDrapApi(externalCompanyId, path, init);
  return { data: result.data, status: result.status, retryAfter: result.retryAfter };
}
