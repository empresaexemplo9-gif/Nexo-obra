import { apiRoute, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { createUpload, createUploadSchema, fileResponse, fileSelect, type OrgFileRow } from "@/lib/server/org-files";

export const dynamic = "force-dynamic";

// Biblioteca da Prancheta: só arquivos prontos e marcados como da biblioteca.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "view");
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    const values: unknown[] = [context.organization.id];
    let filter = "";
    if (projectId) { values.push(projectId); filter = " AND f.project_id = ?2"; }
    const rows = await context.db.prepare(
      `${fileSelect} WHERE f.organization_id = ?1 AND f.in_library = 1 AND f.status = 'ready'${filter}
       ORDER BY f.created_at DESC LIMIT 500`,
    ).bind(...values).all<OrgFileRow>();
    return Response.json({ files: rows.results.map(fileResponse) });
  });
}

// Abre um envio. As partes chegam depois, uma por requisição.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = createUploadSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    return Response.json({ upload: await createUpload(context, parsed.data) }, { status: 201 });
  });
}
