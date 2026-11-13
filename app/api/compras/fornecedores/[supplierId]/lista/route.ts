import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { dia } from "@/lib/server/compras-entrada";
import { hojeDaEmpresa } from "@/lib/server/compras";
import { importarListaDePrecos } from "@/lib/server/compras-listas";
import { listarFornecedores } from "@/lib/server/compras-cadastros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ supplierId: string }> };
const LIMITE = 10 * 1024 * 1024;

async function fornecedorDaRota(request: Request, route: RouteContext) {
  const context = await requireOrganizationContext(request);
  requireModulePermission(context, "purchases", "edit");
  const { supplierId } = await route.params;
  if (!z.string().uuid().safeParse(supplierId).success) throw new ApiError(404, "not_found", "Fornecedor não encontrado.");
  const fornecedor = ensureFound(await context.db.prepare("SELECT id, name FROM suppliers WHERE id = ?1 AND organization_id = ?2")
    .bind(supplierId, context.organization.id).first<{ id: string; name: string }>(), "Fornecedor");
  return { context, fornecedor };
}

// A loja manda a planilha de preços (XLSX ou CSV com descrição, unidade e preço; código
// opcional). Os itens viram catálogo da empresa e entram nas sugestões de fornecedor.
export async function PUT(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { context, fornecedor } = await fornecedorDaRota(request, route);
    const form = await request.formData().catch(() => null);
    if (!form) throw validationError({ arquivo: ["Envie a lista como multipart/form-data."] });
    const arquivo = form.get("arquivo");
    const validade = dia.safeParse(form.get("validOn"));
    if (!validade.success) throw validationError({ validOn: ["Informe a data da lista (AAAA-MM-DD)."] });
    if (validade.data > hojeDaEmpresa(context)) throw validationError({ validOn: ["A data da lista não pode estar no futuro."] });
    if (!(arquivo instanceof File) || !arquivo.size) throw validationError({ arquivo: ["Anexe a planilha da loja (XLSX ou CSV)."] });
    if (arquivo.size > LIMITE) throw validationError({ arquivo: [`O arquivo passa de ${LIMITE / 1048576} MB.`] });
    const resultado = await importarListaDePrecos(context, fornecedor.id, { nome: arquivo.name, bytes: Buffer.from(await arquivo.arrayBuffer()) }, validade.data);
    await context.db.batch([auditStatement(context, "supplier.price_list_imported", "supplier", fornecedor.id, { items: resultado.itens, validOn: validade.data })]);
    return Response.json({ report: resultado, supplier: (await listarFornecedores(context, true)).find((s) => s.id === fornecedor.id) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { context, fornecedor } = await fornecedorDaRota(request, route);
    await context.db.batch([
      context.db.prepare("DELETE FROM supplier_price_items WHERE supplier_id = ?1 AND organization_id = ?2").bind(fornecedor.id, context.organization.id),
      context.db.prepare("DELETE FROM supplier_price_lists WHERE supplier_id = ?1 AND organization_id = ?2").bind(fornecedor.id, context.organization.id),
      auditStatement(context, "supplier.price_list_removed", "supplier", fornecedor.id),
    ]);
    return Response.json({ supplier: (await listarFornecedores(context, true)).find((s) => s.id === fornecedor.id) });
  });
}
