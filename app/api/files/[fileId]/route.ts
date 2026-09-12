import { ApiError, apiRoute, auditStatement, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { deleteObject, getObject } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string }> };
type FileRow = { id: string; storage_key: string; name: string; mime_type: string; project_id: string };

async function ownedFile(context: Awaited<ReturnType<typeof requireOrganizationContext>>, fileId: string) {
  const row = await context.db.prepare(
    "SELECT id, storage_key, name, mime_type, project_id FROM project_files WHERE id = ?1 AND organization_id = ?2",
  ).bind(fileId, context.organization.id).first<FileRow>();
  if (!row) throw new ApiError(404, "not_found", "Arquivo não encontrado.");
  return row;
}

function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "files", "view");
    const { fileId } = await route.params;
    const file = await ownedFile(context, fileId);
    const object = await getObject(file.storage_key);
    if (!object?.body) throw new ApiError(404, "file_content_missing", "O conteúdo deste arquivo não está disponível no armazenamento.");
    return new Response(object.body, {
      headers: {
        "Content-Type": file.mime_type,
        "Content-Disposition": contentDisposition(file.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "files", "edit");
    const { fileId } = await route.params;
    const file = await ownedFile(context, fileId);
    await context.db.batch([
      context.db.prepare("DELETE FROM project_files WHERE id = ?1 AND organization_id = ?2")
        .bind(fileId, context.organization.id),
      auditStatement(context, "file.deleted", "project_file", fileId, { projectId: file.project_id, name: file.name }),
    ]);
    await deleteObject(file.storage_key).catch(() => undefined);
    return new Response(null, { status: 204 });
  });
}
