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
      if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("O XLSX exportado excede 4 MB. Divida os dados em planilhas menores.");
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
    try {
      const body = JSON.stringify({ sheets: await importXlsx(await readXlsxBody(request)) });
      if (Buffer.byteLength(body, "utf8") > 4 * 1024 * 1024) throw new Error("Os dados importados excedem 4 MB de texto. Divida o arquivo em partes menores.");
      return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
    }
    catch (cause) { throw new ApiError(422, "xlsx_import", cause instanceof Error ? cause.message : "Não foi possível importar."); }
  });
}
