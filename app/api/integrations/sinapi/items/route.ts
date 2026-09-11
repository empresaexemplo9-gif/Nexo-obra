import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { isSinapiConfigured, searchSinapiItems } from "@/lib/integrations/sinapi";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    if (!isSinapiConfigured()) {
      return Response.json({ error: "A fonte oficial SINAPI ainda não foi configurada.", code: "sinapi_not_configured" }, { status: 503 });
    }
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const state = url.searchParams.get("uf")?.trim().toUpperCase() ?? "";
    const referenceMonth = url.searchParams.get("referenceMonth")?.trim() ?? "";
    if (query.length < 2 || !/^[A-Z]{2}$/.test(state) || !/^\d{4}-\d{2}$/.test(referenceMonth)) {
      return Response.json({ error: "Informe busca, UF e mês de referência válidos.", code: "invalid_sinapi_search" }, { status: 400 });
    }
    try {
      return Response.json({ items: await searchSinapiItems(query, state, referenceMonth), source: "sinapi" });
    } catch {
      return Response.json({ error: "A fonte SINAPI não respondeu. Tente novamente.", code: "sinapi_unavailable" }, { status: 502 });
    }
  });
}
