import { ApiError, apiRoute, auditStatement, ensureFound, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { budgetResponse, budgetSelect, type BudgetRow } from "@/lib/server/budgets-records";

export const dynamic = "force-dynamic";
type CopyItem = {
  id: string; parent_item_id: string | null; sort_order: number; code: string | null; description: string;
  unit: string; quantity: number; unit_cost_cents: number; unit_price_cents: number; source: string; source_reference: string | null;
};
export async function POST(request: Request, route: { params: Promise<{ budgetId: string }> }) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request); requireModulePermission(context, "budgets", "edit");
    const { budgetId } = await route.params;
    // Header and items are read in the same transaction, including when copying an editable draft.
    const snapshot = await context.db.batch([
      context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(budgetId, context.organization.id),
      context.db.prepare("SELECT i.* FROM budget_items i JOIN budget_versions b ON b.id = i.budget_version_id WHERE b.id = ?1 AND b.organization_id = ?2 ORDER BY i.sort_order LIMIT 2001").bind(budgetId, context.organization.id),
    ]);
    const source = ensureFound((snapshot[0].results[0] as BudgetRow | undefined) ?? null, "Orçamento");
    const items = snapshot[1].results as CopyItem[];
    const latest = await context.db.prepare("SELECT MAX(version) AS version FROM budget_versions WHERE organization_id = ?1 AND code = ?2").bind(context.organization.id, source.code).first<{ version: number }>();
    const id = crypto.randomUUID(), version = (latest?.version ?? 0) + 1;
    if (items.length > 2000) throw new ApiError(400, "budget_too_large", "Esta versão excede o limite de cópia de 2.000 itens.");
    const ids = new Map(items.map(item => [item.id, crypto.randomUUID()]));
    try {
      await context.db.batch([
        context.db.prepare("INSERT INTO budget_versions (id, organization_id, project_id, code, version, status, direct_cost_cents, bdi_percent, margin_percent, total_cents, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,'draft',?6,?7,?8,?9,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
          .bind(id, context.organization.id, source.project_id, source.code, version, source.direct_cost_cents, source.bdi_percent, source.margin_percent, source.total_cents),
        ...items.map(item => context.db.prepare("INSERT INTO budget_items (id,budget_version_id,parent_item_id,sort_order,code,description,unit,quantity,unit_cost_cents,unit_price_cents,source,source_reference) VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,?8,?9,?10,?11)")
          .bind(ids.get(item.id)!, id, item.sort_order, item.code, item.description, item.unit, item.quantity, item.unit_cost_cents, item.unit_price_cents, item.source, item.source_reference)),
        // Establish hierarchy only after every copied parent exists, regardless of display order.
        ...items.filter(item => item.parent_item_id && ids.has(item.parent_item_id)).map(item => context.db.prepare("UPDATE budget_items SET parent_item_id = ?1 WHERE id = ?2 AND budget_version_id = ?3")
          .bind(ids.get(item.parent_item_id!)!, ids.get(item.id)!, id)),
        auditStatement(context, "budget.copied", "budget", id, { sourceBudgetId: budgetId, version }),
      ]);
    } catch (cause) {
      if (String(cause).includes("UNIQUE constraint")) throw new ApiError(409, "budget_version_conflict", "Outra versão foi criada ao mesmo tempo. Atualize e tente novamente.");
      throw cause;
    }
    const created = ensureFound(await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(id, context.organization.id).first<BudgetRow>(), "Orçamento");
    return Response.json({ budget: budgetResponse(created) }, { status: 201 });
  });
}
