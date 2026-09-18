import { ApiError, apiRoute, auditStatement, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { deleteObject, getObject } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assetId: string }> };
type Linha = { id: string; storage_key: string; nome: string; mime_type: string };

async function daEmpresa(context: Awaited<ReturnType<typeof requireOrganizationContext>>, assetId: string) {
  const linha = await context.db.prepare(
    "SELECT id, storage_key, nome, mime_type FROM studio_assets WHERE id = ?1 AND organization_id = ?2",
  ).bind(assetId, context.organization.id).first<Linha>();
  if (!linha) throw new ApiError(404, "not_found", "Item da biblioteca não encontrado.");
  return linha;
}

// A imagem precisa abrir dentro da prancha, então vai sem anexo forçado. O `nosniff` e o
// `sandbox` continuam: arquivo enviado por um membro não pode virar página executando
// script só por estar hospedado no domínio da empresa.
export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "view");
    const { assetId } = await route.params;
    const linha = await daEmpresa(context, assetId);
    const objeto = await getObject(linha.storage_key);
    if (!objeto?.body) throw new ApiError(404, "file_content_missing", "O conteúdo deste item não está disponível no armazenamento.");
    return new Response(objeto.body, {
      headers: {
        "Content-Type": linha.mime_type,
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
    requireModulePermission(context, "studio", "edit");
    const { assetId } = await route.params;
    const linha = await daEmpresa(context, assetId);
    await context.db.batch([
      context.db.prepare("DELETE FROM studio_assets WHERE id = ?1 AND organization_id = ?2")
        .bind(assetId, context.organization.id),
      auditStatement(context, "studio.asset.deleted", "studio_asset", assetId, { nome: linha.nome }),
    ]);
    await deleteObject(linha.storage_key).catch(() => undefined);
    return new Response(null, { status: 204 });
  });
}
