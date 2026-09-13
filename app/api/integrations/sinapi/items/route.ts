import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { isSinapiConfigured, searchSinapiItems } from "@/lib/integrations/sinapi";
import { getDatabase } from "@/db";
import { UFS } from "@/lib/integrations/sinapi-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const state = url.searchParams.get("uf")?.trim().toUpperCase() ?? "";
    const referenceMonth = url.searchParams.get("referenceMonth")?.trim() ?? "";
    const regime = url.searchParams.get("regime") ?? "NaoDesonerado";
    if (query.length < 2 || query.length > 160 || !UFS.includes(state) || (referenceMonth && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(referenceMonth)) || !["Desonerado", "NaoDesonerado"].includes(regime)) {
      return Response.json({ error: "Informe busca, UF e mês de referência válidos.", code: "invalid_sinapi_search" }, { status: 400 });
    }
    const db = getDatabase();
    const active = await db.prepare(`SELECT id,competencia FROM sinapi_competencias WHERE estado='aprovada' AND uf=?1 AND regime=?2
      AND (?3='' OR competencia=?3) ORDER BY competencia DESC LIMIT 1`).bind(state, regime, referenceMonth).first<{ id: string; competencia: string }>();
    if (active) {
      const result = await db.prepare(`SELECT codigo,descricao,unidade,custo_unitario_centavos,tipo FROM sinapi_itens
        WHERE competencia_id=?1 AND (codigo=?2 OR descricao LIKE ?3 ESCAPE '\\') ORDER BY codigo,tipo LIMIT 50`)
        .bind(active.id, query, `%${query.replace(/[\\%_]/g, "\\$&")}%`).all<{ codigo: string; descricao: string; unidade: string; custo_unitario_centavos: number; tipo: string }>();
      return Response.json({ source: "sinapi-local", referenceMonth: active.competencia, regime, items: result.results.map((item) => ({
        code: item.codigo, description: item.descricao, unit: item.unidade, unitCostCents: item.custo_unitario_centavos,
        state, referenceMonth: active.competencia, regime,
        sourceReference: `SINAPI:${state}:${active.competencia}:${regime}:${item.tipo}:${item.codigo}`,
      })) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (!isSinapiConfigured()) {
      return Response.json({ error: "Não há referência SINAPI ativa para esta UF, regime e competência. Consulte o administrador ou deixe a competência vazia para usar a mais recente.", code: "sinapi_not_configured" }, { status: 503 });
    }
    if (!referenceMonth) return Response.json({ error: "A fonte externa exige uma competência.", code: "invalid_sinapi_search" }, { status: 400 });
    try {
      return Response.json({ items: await searchSinapiItems(query, state, referenceMonth, regime), source: "sinapi" });
    } catch {
      return Response.json({ error: "A fonte SINAPI não respondeu. Tente novamente.", code: "sinapi_unavailable" }, { status: 502 });
    }
  });
}
