import { z } from "zod";

import {
  ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { produtoManual } from "@/lib/server/compras-entrada";
import { historicoDePrecos, produtoPorId } from "@/lib/server/compras-cadastros";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ productId: string }> };

async function idDaRota(route: RouteContext) {
  const { productId } = await route.params;
  if (!z.string().uuid().safeParse(productId).success) throw new ApiError(404, "not_found", "Produto não encontrado.");
  return productId;
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    const id = await idDaRota(route);
    const product = ensureFound(await produtoPorId(context, id), "Produto");
    return Response.json({ product, history: await historicoDePrecos(context, id) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const id = await idDaRota(route);
    const atual = ensureFound(await produtoPorId(context, id), "Produto");
    const parsed = produtoManual.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const d = parsed.data;
    // Item de catálogo oficial mantém o custo da fonte: editar à mão apagaria de onde ele veio.
    const custo = atual.source === "manual" ? d.referenceCostCents : atual.referenceCostCents;
    await context.db.batch([
      context.db.prepare(
        `UPDATE purchase_products SET code = ?1, name = ?2, category = ?3, unit = ?4, brand = ?5, specification = ?6, reference_cost_cents = ?7,
           reference_label = CASE WHEN source = 'manual' THEN ?8 ELSE reference_label END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?9 AND organization_id = ?10`,
      ).bind(d.code, d.name, d.category, d.unit, d.brand, d.specification, custo, custo === null ? "" : "Custo informado pela empresa", id, context.organization.id),
      auditStatement(context, "purchase_product.updated", "purchase_product", id),
    ]);
    return Response.json({ product: await produtoPorId(context, id) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const id = await idDaRota(route);
    ensureFound(await produtoPorId(context, id), "Produto");
    await context.db.batch([
      context.db.prepare("UPDATE purchase_products SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND organization_id = ?2").bind(id, context.organization.id),
      auditStatement(context, "purchase_product.deactivated", "purchase_product", id),
    ]);
    return Response.json({ deactivated: true });
  });
}
