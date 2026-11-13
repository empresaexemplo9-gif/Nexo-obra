import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { CENTRAL, itensDeAtencao, nomeDoLocal, produtosEProjetos, saldos } from "@/lib/server/estoque";

export const dynamic = "force-dynamic";

// Saldos por produto e local, itens de atenção com fornecedores alternativos e os últimos
// movimentos. Tudo lido da empresa resolvida pela sessão.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    const [todos, { produtos, projetos }, atencao, limites, movimentos] = await Promise.all([
      saldos(context), produtosEProjetos(context), itensDeAtencao(context),
      context.db.prepare("SELECT product_id, location, minimum FROM stock_minimums WHERE organization_id = ?1").bind(context.organization.id).all<{ product_id: string; location: string; minimum: number }>(),
      context.db.prepare(
        `SELECT m.id, m.product_id, m.project_id, m.kind, m.quantity, m.unit_cost_cents, m.source, m.request_id, m.note, m.occurred_on, m.author_name, m.created_at, r.number AS request_number
         FROM stock_movements m LEFT JOIN purchase_requests r ON r.id = m.request_id AND r.organization_id = m.organization_id
         WHERE m.organization_id = ?1 ORDER BY m.created_at DESC, m.id DESC LIMIT 150`,
      ).bind(context.organization.id).all<{ id: string; product_id: string; project_id: string | null; kind: string; quantity: number; unit_cost_cents: number | null; source: string; request_id: string | null; note: string; occurred_on: string; author_name: string; created_at: string; request_number: number | null }>(),
    ]);
    const chaves = new Map<string, { productId: string; location: string; balance: number; minimum: number | null; lastMovementOn: string | null }>();
    for (const s of todos) chaves.set(`${s.product_id}|${s.location}`, { productId: s.product_id, location: s.location, balance: s.balance, minimum: null, lastMovementOn: s.last_at });
    for (const m of limites.results) {
      const chave = `${m.product_id}|${m.location}`;
      const atual = chaves.get(chave) ?? { productId: m.product_id, location: m.location, balance: 0, minimum: null, lastMovementOn: null };
      chaves.set(chave, { ...atual, minimum: Number(m.minimum) });
    }
    const produto = (id: string) => produtos.find((p) => p.id === id);
    const balances = [...chaves.values()].filter((b) => produto(b.productId)).map((b) => ({
      ...b, productName: produto(b.productId)!.name, unit: produto(b.productId)!.unit, category: produto(b.productId)!.category,
      locationName: nomeDoLocal(b.location, projetos),
      state: b.minimum !== null && b.minimum > 0 && b.balance < b.minimum ? (b.balance <= 0 ? "falta" : "abaixo") : b.balance <= 0 ? "zerado" : "ok",
    })).sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR") || a.locationName.localeCompare(b.locationName, "pt-BR"));
    return Response.json({
      balances, attention: atencao,
      movements: movimentos.results.map((m) => ({
        id: m.id, productId: m.product_id, productName: produto(m.product_id)?.name ?? "Produto removido", unit: produto(m.product_id)?.unit ?? "",
        location: m.project_id ?? CENTRAL, locationName: nomeDoLocal(m.project_id ?? CENTRAL, projetos), kind: m.kind, quantity: Number(m.quantity),
        unitCostCents: m.unit_cost_cents, source: m.source, requestId: m.request_id, requestCode: m.request_number ? `PC-${String(m.request_number).padStart(4, "0")}` : null,
        note: m.note, occurredOn: m.occurred_on, authorName: m.author_name, createdAt: m.created_at,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
