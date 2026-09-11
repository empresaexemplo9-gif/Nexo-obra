import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const catalogItemSchema = z.object({
  code: z.string().trim().min(1).max(40),
  description: z.string().trim().min(3).max(300),
  category: z.string().trim().min(1).max(80).default("Geral"),
  unit: z.string().trim().min(1).max(16).default("un"),
  unitCostCents: z.number().int().nonnegative().default(0),
  defaultUnitPriceCents: z.number().int().nonnegative().nullable().optional(),
});

type CatalogRow = {
  id: string; code: string; description: string; category: string; unit: string;
  unit_cost_cents: number; default_unit_price_cents: number | null; source: string;
  source_reference: string | null; created_at: string; updated_at: string;
};

function response(row: CatalogRow) {
  return { id: row.id, code: row.code, description: row.description, category: row.category, unit: row.unit, unitCostCents: row.unit_cost_cents, defaultUnitPriceCents: row.default_unit_price_cents, source: row.source, sourceReference: row.source_reference, createdAt: row.created_at, updatedAt: row.updated_at };
}

const columns = "id, code, description, category, unit, unit_cost_cents, default_unit_price_cents, source, source_reference, created_at, updated_at";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const statement = query
      ? context.db.prepare(`SELECT ${columns} FROM budget_catalog_items WHERE organization_id = ?1 AND active = 1 AND (code LIKE ?2 OR description LIKE ?2 OR category LIKE ?2) ORDER BY category, description LIMIT 200`).bind(context.organization.id, `%${query}%`)
      : context.db.prepare(`SELECT ${columns} FROM budget_catalog_items WHERE organization_id = ?1 AND active = 1 ORDER BY category, description LIMIT 200`).bind(context.organization.id);
    const rows = await statement.all<CatalogRow>();
    return Response.json({ items: rows.results.map(response) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const parsed = catalogItemSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const id = crypto.randomUUID();
    const data = parsed.data;
    try {
      await context.db.batch([
        context.db.prepare(`INSERT INTO budget_catalog_items (id, organization_id, code, description, category, unit, unit_cost_cents, default_unit_price_cents, source, source_reference, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual', NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(id, context.organization.id, data.code, data.description, data.category, data.unit, data.unitCostCents, data.defaultUnitPriceCents ?? null),
        auditStatement(context, "budget_catalog_item.created", "budget_catalog_item", id, { code: data.code }),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "catalog_code_conflict", "Este código já existe na biblioteca.");
      throw error;
    }
    const item = await context.db.prepare(`SELECT ${columns} FROM budget_catalog_items WHERE id = ?1 AND organization_id = ?2`).bind(id, context.organization.id).first<CatalogRow>();
    return Response.json({ item: response(item!) }, { status: 201 });
  });
}
