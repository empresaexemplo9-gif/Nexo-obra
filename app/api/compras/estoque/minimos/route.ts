import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { CENTRAL } from "@/lib/server/estoque";

export const dynamic = "force-dynamic";

const minimo = z.object({
  productId: z.string().uuid(),
  location: z.string().min(1).max(80),
  minimum: z.number().min(0).max(10_000_000).transform((v) => Math.round(v * 1000) / 1000),
}).strict();

// Estoque mínimo por produto e local. Zero tira o produto da vigilância de falta.
export async function PUT(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const parsed = minimo.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const d = parsed.data;
    const produto = await context.db.prepare("SELECT id FROM purchase_products WHERE id = ?1 AND organization_id = ?2").bind(d.productId, context.organization.id).first();
    if (!produto) throw new ApiError(400, "product_not_found", "Produto não encontrado no cadastro desta empresa.");
    if (d.location !== CENTRAL && !await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2").bind(d.location, context.organization.id).first()) {
      throw new ApiError(400, "project_not_found", "A obra informada não pertence a esta empresa.");
    }
    const id = crypto.randomUUID();
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO stock_minimums (id, organization_id, product_id, location, minimum, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (organization_id, product_id, location) DO UPDATE SET minimum = excluded.minimum, updated_at = excluded.updated_at`,
      ).bind(id, context.organization.id, d.productId, d.location, d.minimum, new Date().toISOString()),
      auditStatement(context, "stock.minimum_set", "purchase_product", d.productId, { location: d.location, minimum: d.minimum }),
    ]);
    return Response.json({ saved: true });
  });
}
