import { z } from "zod";

import { ApiError, apiRoute, ensureFound, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { produtosCotadosPeloFornecedor } from "@/lib/server/compras-cadastros";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ supplierId: string }> };

// Produtos que o fornecedor já cotou para a empresa. Os itens da lista de preços dele vêm
// do catálogo (fonte "fornecedor" filtrada pelo id), que já pagina e busca.
export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    const { supplierId } = await route.params;
    if (!z.string().uuid().safeParse(supplierId).success) throw new ApiError(404, "not_found", "Fornecedor não encontrado.");
    ensureFound(await context.db.prepare("SELECT id FROM suppliers WHERE id = ?1 AND organization_id = ?2").bind(supplierId, context.organization.id).first(), "Fornecedor");
    return Response.json({ quoted: await produtosCotadosPeloFornecedor(context, supplierId) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
