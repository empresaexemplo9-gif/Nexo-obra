import { apiRoute, ensureFound, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { budgetSelect, type BudgetRow } from "@/lib/server/budgets-records";
export const dynamic = "force-dynamic";
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const quantity = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
type ClientRow = { name: string; document: string | null; email: string | null; phone: string | null };

// Data de emissão no fuso da empresa: o servidor roda em UTC, e às 21h de Brasília a
// proposta saía com a data do dia seguinte.
function issuedOn(timezone: string) {
  try { return new Date().toLocaleDateString("pt-BR", { timeZone: timezone }); }
  catch { return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); }
}

export async function GET(request: Request, route: { params: Promise<{ budgetId: string }> }) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request); requireModulePermission(context, "budgets", "view");
    const { budgetId } = await route.params;
    const budget = ensureFound(await context.db.prepare(`${budgetSelect} WHERE b.id = ?1 AND b.organization_id = ?2`).bind(budgetId, context.organization.id).first<BudgetRow>(), "Orçamento");
    const items = await context.db.prepare("SELECT description, unit, quantity, unit_price_cents FROM budget_items WHERE budget_version_id = ?1 ORDER BY sort_order").bind(budgetId).all<{ description: string; unit: string; quantity: number; unit_price_cents: number }>();
    // Cliente do projeto, da mesma empresa: a proposta é para ele, e sem o nome ela não identifica a quem se dirige.
    const client = await context.db.prepare(
      `SELECT c.name, c.document, c.email, c.phone FROM budget_versions b
       JOIN projects p ON p.id = b.project_id AND p.organization_id = b.organization_id
       JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
       WHERE b.id = ?1 AND b.organization_id = ?2`,
    ).bind(budgetId, context.organization.id).first<ClientRow>();
    const status = { draft: "Rascunho", sent: "Enviado", approved: "Aprovação registrada", rejected: "Recusado", archived: "Arquivado" }[budget.status] ?? budget.status;
    const clientContact = client ? [client.document, client.email, client.phone].filter(Boolean).map(escape).join(" · ") : "";
    const clientBlock = client
      ? `<section class="party"><p class="label">Cliente</p><p class="name">${escape(client.name)}</p>${clientContact ? `<p>${clientContact}</p>` : ""}</section>`
      : "";
    const acceptance = budget.status === "rejected" || budget.status === "archived" ? "" : `<section class="accept"><p class="label">Aceite do cliente</p><p>Declaro estar de acordo com os itens e valores desta proposta.</p><div class="signatures"><div><span></span>${escape(client?.name ?? "Nome do cliente")}</div><div><span></span>Data</div></div></section>`;
    return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proposta ${escape(budget.code)} · v${budget.version}</title><style>body{font:14px Arial,sans-serif;color:#1c190f;max-width:960px;margin:32px auto;padding:24px}h1{font-size:28px;margin:4px 0 8px}.brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#846100}.label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b6450;margin:0 0 4px}.party{margin:24px 0;padding:16px;border:1px solid #d9d4c3}.party p{margin:2px 0}.party .name{font-size:16px;font-weight:bold}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:10px;border-bottom:1px solid #ccc;text-align:left}td:nth-child(n+3),th:nth-child(n+3){text-align:right;white-space:nowrap}thead{display:table-header-group}tr{break-inside:avoid}.total{text-align:right;font-size:20px}.hint{padding:12px;background:#f4f2e9}.accept{margin-top:40px;break-inside:avoid}.signatures{display:grid;grid-template-columns:2fr 1fr;gap:32px;margin-top:48px}.signatures span{display:block;border-top:1px solid #1c190f;margin-bottom:6px}.note{color:#6b6450;font-size:12px;margin-top:32px}@media print{body{margin:0;padding:0}.hint{display:none}@page{size:A4;margin:18mm}}@media(max-width:480px){body{margin:0;padding:16px}.signatures{grid-template-columns:1fr}}</style></head><body><p class="hint">Use Imprimir no navegador (Ctrl+P) para salvar como PDF.</p><p class="brand">${escape(context.organization.name)}</p><h1>Proposta ${escape(budget.code)} · v${budget.version}</h1><p>${escape(budget.project_name)} · ${escape(status)} · emitida em ${escape(issuedOn(context.organization.timezone))}</p>${clientBlock}<div class="table-wrap"><table><thead><tr><th>Descrição</th><th>Unidade</th><th>Quantidade</th><th>Preço unitário</th><th>Total</th></tr></thead><tbody>${items.results.map(item => `<tr><td>${escape(item.description)}</td><td>${escape(item.unit)}</td><td>${escape(quantity(item.quantity))}</td><td>${escape(money(item.unit_price_cents))}</td><td>${escape(money(Math.round(item.quantity * item.unit_price_cents)))}</td></tr>`).join("")}</tbody></table></div><p class="total">Total: <strong>${escape(money(budget.total_cents))}</strong></p>${acceptance}<p class="note">O registro de situação na plataforma não substitui a manifestação de aceite do cliente. Gerado na H.OIKOS.</p></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
  });
}
