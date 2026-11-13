import {
  ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { produtoDoCatalogo, produtoManual } from "@/lib/server/compras-entrada";
import { listarProdutos, produtoPorId } from "@/lib/server/compras-cadastros";
import { resolverReferencia } from "@/lib/server/compras";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    const busca = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 120);
    return Response.json({ products: await listarProdutos(context, busca) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

// Dois caminhos: cadastro manual, ou cópia de um item de catálogo (materiais padrão ABNT,
// lista de preços de um fornecedor, GOINFRA, SINAPI ou a biblioteca da empresa). No segundo, a tela manda só a referência; descrição, unidade e
// custo são lidos aqui, da fonte.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const corpo = await jsonBody(request);
    const doCatalogo = produtoDoCatalogo.safeParse(corpo);
    const id = crypto.randomUUID();
    let instrucao;
    if (doCatalogo.success) {
      if (doCatalogo.data.reference.startsWith("BIBLIOTECA:")) requireModulePermission(context, "budgets", "view");
      const item = await resolverReferencia(context, doCatalogo.data.reference);
      const existente = await context.db.prepare("SELECT id, active FROM purchase_products WHERE organization_id = ?1 AND source_reference = ?2")
        .bind(context.organization.id, item.reference).first<{ id: string; active: number }>();
      if (existente) {
        // Repetir a importação devolve o mesmo produto (reativado), sem duplicar o cadastro.
        if (!existente.active) await context.db.prepare("UPDATE purchase_products SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND organization_id = ?2").bind(existente.id, context.organization.id).run();
        return Response.json({ product: await produtoPorId(context, existente.id), existing: true });
      }
      instrucao = context.db.prepare(
        `INSERT INTO purchase_products (id, organization_id, code, name, category, unit, brand, specification, source, source_reference, reference_cost_cents, reference_label, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, ?8, ?9, ?10, ?11, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(id, context.organization.id, item.code.slice(0, 40), item.description.slice(0, 200), item.category.slice(0, 80), item.unit.slice(0, 16),
        (item.specification ?? "").slice(0, 1000), item.source, item.reference, item.unitCostCents, item.label);
    } else {
      const parsed = produtoManual.safeParse(corpo);
      if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
      const d = parsed.data;
      instrucao = context.db.prepare(
        `INSERT INTO purchase_products (id, organization_id, code, name, category, unit, brand, specification, source, source_reference, reference_cost_cents, reference_label, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual', NULL, ?9, ?10, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(id, context.organization.id, d.code, d.name, d.category, d.unit, d.brand, d.specification, d.referenceCostCents, d.referenceCostCents === null ? "" : "Custo informado pela empresa");
    }
    try {
      await context.db.batch([instrucao, auditStatement(context, "purchase_product.created", "purchase_product", id, { source: doCatalogo.success ? doCatalogo.data.reference.split(":")[0] : "manual" })]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "product_conflict", "Este item do catálogo já está no cadastro.");
      throw error;
    }
    return Response.json({ product: await produtoPorId(context, id) }, { status: 201 });
  });
}
