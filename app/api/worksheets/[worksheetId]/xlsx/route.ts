import { ApiError, apiRoute, requireOrganizationContext } from "@/lib/server/backend";
import { loadWorksheet } from "@/lib/server/worksheet-access";
import { exportXlsx, importXlsx, readXlsxBody } from "@/lib/server/worksheet-xlsx";
import { contentSchema } from "@/lib/worksheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ worksheetId: string }> };

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { row } = await loadWorksheet(context, (await route.params).worksheetId);
    const revision = new URL(request.url).searchParams.get("revision");
    if (revision !== null && Number(revision) !== row.revision) throw new ApiError(409, "worksheet_conflict", "A planilha mudou em outro acesso. Reabra antes de exportar.");
    if (row.kind === "document") throw new ApiError(400, "not_sheet", "Escolha uma planilha.");
    try {
      const bytes = await exportXlsx(row.name, contentSchema.parse(JSON.parse(row.content_json)), row.columns);
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="planilha.xlsx"; filename*=UTF-8''${encodeURIComponent(row.name + ".xlsx")}`, "Cache-Control": "private, no-store" } });
    } catch (cause) { throw new ApiError(422, "xlsx_export", cause instanceof Error ? cause.message : "Não foi possível exportar."); }
  });
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { access, row } = await loadWorksheet(context, (await route.params).worksheetId);
    if (!access.canEdit) throw new ApiError(403, "worksheet_read_only", "Seu acesso a esta planilha é somente de leitura.");
    if (row.kind === "document") throw new ApiError(400, "not_sheet", "Escolha uma planilha.");
    try { return Response.json({ sheets: await importXlsx(await readXlsxBody(request)) }, { headers: { "Cache-Control": "private, no-store" } }); }
    catch (cause) { throw new ApiError(422, "xlsx_import", cause instanceof Error ? cause.message : "Não foi possível importar."); }
  });
}
