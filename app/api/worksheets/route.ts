import {
  ApiError,
  apiRoute,
  auditStatement,
  isPlatformSuperAdmin,
  jsonBody,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";
import { worksheetResponse, worksheetSchema, type WorksheetRow } from "@/lib/worksheets";
import { buildTemplateContent, templateById } from "@/lib/worksheet-templates";
import { enforceWorksheetValidation } from "@/lib/server/worksheet-validation";

export const dynamic = "force-dynamic";

// A planilha e o documento são ferramentas de trabalho da empresa: todo acesso com
// contexto de empresa pode criar e usar, e cada escrita entra na auditoria.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const superAdmin = isPlatformSuperAdmin(context);
    // A planilha restrita só entra na lista de quem tem liberação — ou do superadmin.
    const result = await context.db.prepare(
      `SELECT w.id, w.organization_id, w.kind, w.name, '{}' AS content_json, w.columns, w.rows,
        w.created_by_member_id, w.created_by_name, w.visibility, w.revision, w.created_at, w.updated_at,
        g.level AS grant_level
       FROM worksheets w
       LEFT JOIN worksheet_grants g ON g.worksheet_id = w.id AND g.member_id = ?2
       WHERE w.organization_id = ?1
         AND (w.visibility != 'restricted' OR ?3 = 1 OR g.level IS NOT NULL)
       ORDER BY w.updated_at DESC LIMIT 200`,
    ).bind(context.organization.id, context.member.id, superAdmin ? 1 : 0).all<WorksheetRow & { grant_level: string | null }>();
    return Response.json({
      worksheets: result.results.map((row) => {
        const { content, ...rest } = worksheetResponse(row); void content;
        return { ...rest, access: superAdmin ? "superadmin" : row.visibility === "restricted" ? row.grant_level : "empresa" };
      }),
      canGovern: superAdmin,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = worksheetSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    // A planilha de saúde financeira nasce restrita e sob governo do superadministrador.
    if (data.kind === "analysis" && !isPlatformSuperAdmin(context)) {
      throw new ApiError(403, "analysis_superadmin_only", "Somente o superadministrador cria planilhas de saúde financeira.");
    }
    const visibility = data.kind === "analysis" ? "restricted" : "organization";

    let { content, columns, rows } = data;
    if (data.templateId) {
      const template = templateById(data.templateId);
      if (!template) throw new ApiError(404, "template_not_found", "Modelo não encontrado.");
      const built = buildTemplateContent(template);
      content = { cells: built.cells, body: built.body, widths: built.widths, formats: built.formats, bold: built.bold, analysis: built.analysis, recipes: [], frozenColumns: 0, styles: {}, merges: [] };
      columns = built.columns;
      rows = built.rows;
    }
    enforceWorksheetValidation(content);
    const id = crypto.randomUUID();
    const now = Date.now();
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO worksheets (
          id, organization_id, kind, name, content_json, columns, rows,
          created_by_member_id, created_by_name, visibility, revision, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11)`,
      ).bind(id, context.organization.id, data.kind, data.name, JSON.stringify(content),
        columns, rows, context.member.id, context.user.displayName, visibility, now),
      auditStatement(context, "worksheet.created", "worksheet", id, { kind: data.kind, name: data.name }),
    ]);
    const row = await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
      .bind(id, context.organization.id).first<WorksheetRow>();
    return Response.json({ worksheet: worksheetResponse(row!) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}
