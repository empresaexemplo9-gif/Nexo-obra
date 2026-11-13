import type { OrganizationContext } from "@/lib/server/backend";

// Fornecedores e produtos de Compras, com o histórico que sai das compras reais: quantas
// vezes o fornecedor cotou, ganhou, entregou no prazo e quanto se comprou dele.

type FornecedorRow = {
  id: string; name: string; document: string | null; contact_name: string; email: string; phone: string; city: string; uf: string;
  categories: string; payment_terms: string; lead_time_days: number | null; negotiation_score: number | null; notes: string;
  active: number; created_at: string; updated_at: string;
  quotes: number; won: number; delivered: number; on_time: number; avg_lead: number | null; purchased_cents: number | null;
  registry_name: string | null; registry_status: string | null; registry_activity: string | null; registry_checked_at: string | null;
  list_valid_on: string | null; list_items: number | null; list_file: string | null;
};

export async function listarFornecedores(context: OrganizationContext, incluirInativos = false) {
  const { results } = await context.db.prepare(
    `SELECT s.id, s.name, s.document, s.contact_name, s.email, s.phone, s.city, s.uf, s.categories, s.payment_terms,
       s.lead_time_days, s.negotiation_score, s.notes, s.active, s.created_at, s.updated_at,
       s.registry_name, s.registry_status, s.registry_activity, s.registry_checked_at,
       l.valid_on AS list_valid_on, l.total_items AS list_items, l.file_name AS list_file,
       (SELECT COUNT(*) FROM purchase_quotes q WHERE q.organization_id = s.organization_id AND q.supplier_id = s.id) AS quotes,
       (SELECT COUNT(*) FROM purchase_requests r JOIN purchase_quotes q ON q.id = r.selected_quote_id AND q.organization_id = r.organization_id
          WHERE r.organization_id = s.organization_id AND q.supplier_id = s.id AND r.status IN ('comprado', 'em_entrega', 'entregue')) AS won,
       (SELECT COUNT(*) FROM purchase_requests r JOIN purchase_quotes q ON q.id = r.selected_quote_id AND q.organization_id = r.organization_id
          WHERE r.organization_id = s.organization_id AND q.supplier_id = s.id AND r.status = 'entregue') AS delivered,
       (SELECT COUNT(*) FROM purchase_requests r JOIN purchase_quotes q ON q.id = r.selected_quote_id AND q.organization_id = r.organization_id
          WHERE r.organization_id = s.organization_id AND q.supplier_id = s.id AND r.status = 'entregue'
            AND r.expected_delivery_date IS NOT NULL AND r.delivered_at <= r.expected_delivery_date) AS on_time,
       (SELECT AVG(julianday(r.delivered_at) - julianday(r.ordered_at)) FROM purchase_requests r JOIN purchase_quotes q ON q.id = r.selected_quote_id AND q.organization_id = r.organization_id
          WHERE r.organization_id = s.organization_id AND q.supplier_id = s.id AND r.status = 'entregue' AND r.ordered_at IS NOT NULL) AS avg_lead,
       (SELECT SUM(r.purchased_total_cents) FROM purchase_requests r JOIN purchase_quotes q ON q.id = r.selected_quote_id AND q.organization_id = r.organization_id
          WHERE r.organization_id = s.organization_id AND q.supplier_id = s.id AND r.status IN ('comprado', 'em_entrega', 'entregue')) AS purchased_cents
     FROM suppliers s
     LEFT JOIN supplier_price_lists l ON l.supplier_id = s.id AND l.organization_id = s.organization_id
     WHERE s.organization_id = ?1 AND (?2 = 1 OR s.active = 1)
     ORDER BY s.active DESC, s.name LIMIT 500`,
  ).bind(context.organization.id, incluirInativos ? 1 : 0).all<FornecedorRow>();
  return results.map((s) => ({
    id: s.id, name: s.name, document: s.document ?? "", contactName: s.contact_name, email: s.email, phone: s.phone, city: s.city, uf: s.uf,
    categories: s.categories, paymentTerms: s.payment_terms, leadTimeDays: s.lead_time_days, negotiationScore: s.negotiation_score,
    notes: s.notes, active: Boolean(s.active), createdAt: s.created_at, updatedAt: s.updated_at,
    registry: s.registry_checked_at ? { name: s.registry_name ?? "", status: s.registry_status ?? "", activity: s.registry_activity ?? "", checkedAt: s.registry_checked_at } : null,
    priceList: s.list_valid_on ? { validOn: s.list_valid_on, items: Number(s.list_items ?? 0), fileName: s.list_file ?? "" } : null,
    stats: {
      quotes: Number(s.quotes), won: Number(s.won), delivered: Number(s.delivered), onTime: Number(s.on_time),
      averageLeadDays: s.avg_lead === null ? null : Math.round(Number(s.avg_lead) * 10) / 10,
      purchasedCents: Number(s.purchased_cents ?? 0),
    },
  }));
}

type ProdutoRow = {
  id: string; code: string; name: string; category: string; unit: string; brand: string; specification: string; source: string;
  source_reference: string | null; reference_cost_cents: number | null; reference_label: string; active: number; created_at: string; updated_at: string;
  last_price_cents: number | null; quotes: number;
};

export const colunasProduto = `p.id, p.code, p.name, p.category, p.unit, p.brand, p.specification, p.source, p.source_reference,
  p.reference_cost_cents, p.reference_label, p.active, p.created_at, p.updated_at,
  (SELECT qi.unit_price_cents FROM purchase_quote_items qi JOIN purchase_request_items i ON i.id = qi.request_item_id AND i.organization_id = qi.organization_id
     WHERE i.organization_id = p.organization_id AND i.product_id = p.id ORDER BY qi.rowid DESC LIMIT 1) AS last_price_cents,
  (SELECT COUNT(*) FROM purchase_quote_items qi JOIN purchase_request_items i ON i.id = qi.request_item_id AND i.organization_id = qi.organization_id
     WHERE i.organization_id = p.organization_id AND i.product_id = p.id) AS quotes`;

export const produtoJson = (p: ProdutoRow) => ({
  id: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit, brand: p.brand, specification: p.specification,
  source: p.source, sourceReference: p.source_reference, referenceCostCents: p.reference_cost_cents, referenceLabel: p.reference_label,
  active: Boolean(p.active), createdAt: p.created_at, updatedAt: p.updated_at,
  lastQuotedCents: p.last_price_cents === null ? null : Number(p.last_price_cents), quoteCount: Number(p.quotes),
});

export async function listarProdutos(context: OrganizationContext, busca: string) {
  const termo = `%${busca.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const { results } = await context.db.prepare(
    `SELECT ${colunasProduto} FROM purchase_products p
     WHERE p.organization_id = ?1 AND p.active = 1 AND (?2 = '%%' OR p.name LIKE ?2 ESCAPE '\\' OR p.code LIKE ?2 ESCAPE '\\' OR p.category LIKE ?2 ESCAPE '\\' OR p.brand LIKE ?2 ESCAPE '\\')
     ORDER BY p.category, p.name LIMIT 300`,
  ).bind(context.organization.id, termo).all<ProdutoRow>();
  return results.map(produtoJson);
}

export async function produtoPorId(context: OrganizationContext, id: string) {
  const row = await context.db.prepare(`SELECT ${colunasProduto} FROM purchase_products p WHERE p.id = ?1 AND p.organization_id = ?2`)
    .bind(id, context.organization.id).first<ProdutoRow>();
  return row ? produtoJson(row) : null;
}

/** Preços que cada fornecedor deu para o produto, do mais recente para o mais antigo. */
export async function historicoDePrecos(context: OrganizationContext, productId: string) {
  const { results } = await context.db.prepare(
    `SELECT qi.unit_price_cents, q.delivery_days, q.updated_at, s.name AS supplier_name, r.number, r.id AS request_id,
       CASE WHEN r.selected_quote_id = q.id AND r.status IN ('comprado', 'em_entrega', 'entregue') THEN 1 ELSE 0 END AS bought
     FROM purchase_quote_items qi
     JOIN purchase_request_items i ON i.id = qi.request_item_id AND i.organization_id = qi.organization_id
     JOIN purchase_quotes q ON q.id = qi.quote_id AND q.organization_id = qi.organization_id
     JOIN suppliers s ON s.id = q.supplier_id AND s.organization_id = q.organization_id
     JOIN purchase_requests r ON r.id = i.request_id AND r.organization_id = i.organization_id
     WHERE qi.organization_id = ?1 AND i.product_id = ?2
     ORDER BY q.updated_at DESC LIMIT 50`,
  ).bind(context.organization.id, productId).all<{ unit_price_cents: number; delivery_days: number; updated_at: string; supplier_name: string; number: number; request_id: string; bought: number }>();
  return results.map((h) => ({
    unitPriceCents: Number(h.unit_price_cents), deliveryDays: Number(h.delivery_days), quotedAt: h.updated_at,
    supplierName: h.supplier_name, requestNumber: Number(h.number), requestId: h.request_id, bought: Boolean(h.bought),
  }));
}
