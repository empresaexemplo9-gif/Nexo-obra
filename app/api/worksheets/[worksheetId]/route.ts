import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  ensureFound,
  isPlatformSuperAdmin,
  jsonBody,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";
import { SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from "@/lib/spreadsheet";
import { contentSchema, worksheetResponse, type WorksheetRow } from "@/lib/worksheets";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ worksheetId: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  columns: z.number().int().min(1).max(SHEET_MAX_COLUMNS).optional(),
  rows: z.number().int().min(1).max(SHEET_MAX_ROWS).optional(),
  content: contentSchema.optional(),
  revision: z.number().int().min(1),
}).strict();

function worksheetId(value: string) {
  if (!z.string().uuid().safeParse(value).success) throw new ApiError(404, "not_found", "Planilha não encontrada.");
  return value;
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { worksheetId: id } = await route.params;
    const row = ensureFound(await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
      .bind(worksheetId(id), context.organization.id).first<WorksheetRow>(), "Planilha");
    return Response.json({ worksheet: worksheetResponse(row) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

// A revisão evita que duas pessoas sobrescrevam o trabalho uma da outra em silêncio.
export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { worksheetId: id } = await route.params;
    const parsed = updateSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const current = ensureFound(await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
      .bind(worksheetId(id), context.organization.id).first<WorksheetRow>(), "Planilha");

    const result = await context.db.prepare(
      `UPDATE worksheets SET name = ?1, columns = ?2, rows = ?3, content_json = ?4,
        revision = revision + 1, updated_at = ?5
       WHERE id = ?6 AND organization_id = ?7 AND revision = ?8`,
    ).bind(
      data.name ?? current.name,
      data.columns ?? current.columns,
      data.rows ?? current.rows,
      data.content ? JSON.stringify(data.content) : current.content_json,
      Date.now(), current.id, context.organization.id, data.revision,
    ).run();
    if (!result.meta.changes) {
      throw new ApiError(409, "worksheet_conflict", "Esta planilha mudou em outro acesso. Recarregue antes de salvar.");
    }
    await auditStatement(context, "worksheet.updated", "worksheet", current.id, { name: data.name ?? current.name }).run();
    const row = await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
      .bind(current.id, context.organization.id).first<WorksheetRow>();
    return Response.json({ worksheet: worksheetResponse(row!) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { worksheetId: id } = await route.params;
    const row = ensureFound(await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
      .bind(worksheetId(id), context.organization.id).first<WorksheetRow>(), "Planilha");
    const privileged = isPlatformSuperAdmin(context) || ["owner", "admin"].includes(context.member.role);
    if (!privileged && row.created_by_member_id !== context.member.id) {
      throw new ApiError(403, "worksheet_owner_required", "Somente quem criou a planilha, o contratante ou um administrador pode excluí-la.");
    }
    await context.db.batch([
      context.db.prepare("DELETE FROM worksheets WHERE id = ?1 AND organization_id = ?2").bind(row.id, context.organization.id),
      auditStatement(context, "worksheet.deleted", "worksheet", row.id, { name: row.name }),
    ]);
    return Response.json({ deleted: true });
  });
}
