import {
  apiRoute,
  auditStatement,
  jsonBody,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";
import { worksheetResponse, worksheetSchema, type WorksheetRow } from "@/lib/worksheets";

export const dynamic = "force-dynamic";

// A planilha e o documento são ferramentas de trabalho da empresa: todo acesso com
// contexto de empresa pode criar e usar, e cada escrita entra na auditoria.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const result = await context.db.prepare(
      `SELECT id, organization_id, kind, name, '{}' AS content_json, columns, rows,
        created_by_member_id, created_by_name, revision, created_at, updated_at
       FROM worksheets WHERE organization_id = ?1 ORDER BY updated_at DESC LIMIT 200`,
    ).bind(context.organization.id).all<WorksheetRow>();
    return Response.json({
      worksheets: result.results.map((row) => { const { content, ...rest } = worksheetResponse(row); void content; return rest; }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = worksheetSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const id = crypto.randomUUID();
    const now = Date.now();
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO worksheets (
          id, organization_id, kind, name, content_json, columns, rows,
          created_by_member_id, created_by_name, revision, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10)`,
      ).bind(id, context.organization.id, data.kind, data.name, JSON.stringify(data.content),
        data.columns, data.rows, context.member.id, context.user.displayName, now),
      auditStatement(context, "worksheet.created", "worksheet", id, { kind: data.kind, name: data.name }),
    ]);
    const row = await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
      .bind(id, context.organization.id).first<WorksheetRow>();
    return Response.json({ worksheet: worksheetResponse(row!) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}
