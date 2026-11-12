import { ApiError, ensureFound, type OrganizationContext } from "@/lib/server/backend";
import { usageDayKey } from "@/lib/server/usage";
import {
  compararCotacoes, numeroDoPedido, situacaoDaEntrega, totalDaLinha,
  type CotacaoParaComparar, type StatusCompra,
} from "@/lib/compras";
import { rotuloRegimeGoinfra, rotuloTabelaGoinfra, type TabelaGoinfra } from "@/lib/integrations/goinfra-planilha";
import { DEFAULT_SINAPI_UF } from "@/lib/integrations/sinapi-contract";
import { preparadorDeSugestoes } from "@/lib/server/estoque";

// Leitura do módulo Compras. Toda consulta filtra a empresa resolvida pela sessão; o id
// que vem do navegador só escolhe entre registros que já são da empresa.

const encerradaOuNao = (status: StatusCompra) => status === "entregue" || status === "cancelado";

export const hojeDaEmpresa = (context: OrganizationContext) => usageDayKey(Date.now(), context.organization.timezone);

export type PedidoRow = {
  id: string; number: number; project_id: string | null; title: string; status: StatusCompra; priority: string;
  needed_by: string | null; delivery_address: string; notes: string; selected_quote_id: string | null;
  order_number: string; ordered_at: string | null; purchased_total_cents: number | null;
  expected_delivery_date: string | null; carrier: string; tracking_code: string; dispatched_at: string | null;
  delivered_at: string | null; cancel_reason: string; revision: number; created_by_name: string;
  created_at: string; updated_at: string; project_name?: string | null; project_code?: string | null;
};

export type ItemRow = {
  id: string; request_id: string; product_id: string | null; position: number; description: string; unit: string;
  quantity: number; received_quantity: number; reference_cost_cents: number | null;
};

type CotacaoRow = {
  id: string; request_id: string; supplier_id: string; supplier_name: string; supplier_phone: string; supplier_email: string;
  delivery_days: number; payment_terms: string; payment_days: number; freight_cents: number; discount_cents: number;
  valid_until: string | null; negotiation_score: number; notes: string; created_by_name: string; updated_at: string;
};

const colunasPedido = `r.id, r.number, r.project_id, r.title, r.status, r.priority, r.needed_by, r.delivery_address, r.notes,
  r.selected_quote_id, r.order_number, r.ordered_at, r.purchased_total_cents, r.expected_delivery_date, r.carrier,
  r.tracking_code, r.dispatched_at, r.delivered_at, r.cancel_reason, r.revision, r.created_by_name, r.created_at, r.updated_at,
  p.name AS project_name, p.code AS project_code`;

export async function carregarPedido(context: OrganizationContext, id: string): Promise<PedidoRow> {
  return ensureFound(await context.db.prepare(
    `SELECT ${colunasPedido} FROM purchase_requests r
     LEFT JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
     WHERE r.id = ?1 AND r.organization_id = ?2`,
  ).bind(id, context.organization.id).first<PedidoRow>(), "Pedido de compra");
}

export function exigirRevisao(pedido: PedidoRow, revisao: number) {
  if (pedido.revision !== revisao) {
    throw new ApiError(409, "revision_conflict", "Este pedido foi alterado por outra pessoa. Recarregue para ver a versão atual.");
  }
}

export async function itensDoPedido(context: OrganizationContext, requestIds: string[]): Promise<ItemRow[]> {
  if (!requestIds.length) return [];
  const marcadores = requestIds.map((_, i) => `?${i + 2}`).join(",");
  const { results } = await context.db.prepare(
    `SELECT id, request_id, product_id, position, description, unit, quantity, received_quantity, reference_cost_cents
     FROM purchase_request_items WHERE organization_id = ?1 AND request_id IN (${marcadores}) ORDER BY position, id`,
  ).bind(context.organization.id, ...requestIds).all<ItemRow>();
  return results;
}

async function cotacoesDoPedido(context: OrganizationContext, requestIds: string[]) {
  if (!requestIds.length) return { cotacoes: [] as CotacaoRow[], precos: [] as { quote_id: string; request_item_id: string; unit_price_cents: number }[] };
  const marcadores = requestIds.map((_, i) => `?${i + 2}`).join(",");
  const cotacoes = await context.db.prepare(
    `SELECT q.id, q.request_id, q.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone, s.email AS supplier_email,
       q.delivery_days, q.payment_terms, q.payment_days, q.freight_cents, q.discount_cents, q.valid_until,
       q.negotiation_score, q.notes, q.created_by_name, q.updated_at
     FROM purchase_quotes q JOIN suppliers s ON s.id = q.supplier_id AND s.organization_id = q.organization_id
     WHERE q.organization_id = ?1 AND q.request_id IN (${marcadores}) ORDER BY q.created_at, q.id`,
  ).bind(context.organization.id, ...requestIds).all<CotacaoRow>();
  const precos = await context.db.prepare(
    `SELECT qi.quote_id, qi.request_item_id, qi.unit_price_cents FROM purchase_quote_items qi
     JOIN purchase_quotes q ON q.id = qi.quote_id AND q.organization_id = qi.organization_id
     WHERE qi.organization_id = ?1 AND q.request_id IN (${marcadores})`,
  ).bind(context.organization.id, ...requestIds).all<{ quote_id: string; request_item_id: string; unit_price_cents: number }>();
  return { cotacoes: cotacoes.results, precos: precos.results };
}

function paraComparar(cotacoes: CotacaoRow[], precos: { quote_id: string; request_item_id: string; unit_price_cents: number }[]): CotacaoParaComparar[] {
  return cotacoes.map((q) => ({
    id: q.id, supplierId: q.supplier_id, supplierName: q.supplier_name,
    deliveryDays: Number(q.delivery_days), paymentDays: Number(q.payment_days), freightCents: Number(q.freight_cents),
    discountCents: Number(q.discount_cents), negotiationScore: Number(q.negotiation_score), validUntil: q.valid_until,
    prices: Object.fromEntries(precos.filter((p) => p.quote_id === q.id).map((p) => [p.request_item_id, Number(p.unit_price_cents)])),
  }));
}

const itemJson = (item: ItemRow) => ({
  id: item.id, productId: item.product_id, description: item.description, unit: item.unit,
  quantity: Number(item.quantity), receivedQuantity: Number(item.received_quantity), referenceCostCents: item.reference_cost_cents,
});

function resumoDoPedido(pedido: PedidoRow, itens: ItemRow[], comparativo: ReturnType<typeof compararCotacoes>, cotacoes: CotacaoRow[], hoje: string) {
  const escolhida = comparativo.linhas.find((linha) => linha.quoteId === pedido.selected_quote_id) ?? null;
  const parcial = itens.some((item) => Number(item.received_quantity) > 0) && itens.some((item) => Number(item.received_quantity) < Number(item.quantity));
  const fornecedor = cotacoes.find((q) => q.id === pedido.selected_quote_id) ?? null;
  return {
    id: pedido.id, number: pedido.number, code: numeroDoPedido(pedido.number), title: pedido.title, status: pedido.status,
    priority: pedido.priority, projectId: pedido.project_id, projectName: pedido.project_name ?? null, projectCode: pedido.project_code ?? null,
    neededBy: pedido.needed_by, deliveryAddress: pedido.delivery_address, notes: pedido.notes,
    selectedQuoteId: pedido.selected_quote_id, supplierId: fornecedor?.supplier_id ?? null, supplierName: fornecedor?.supplier_name ?? null,
    orderNumber: pedido.order_number, orderedAt: pedido.ordered_at, expectedDeliveryDate: pedido.expected_delivery_date,
    carrier: pedido.carrier, trackingCode: pedido.tracking_code, dispatchedAt: pedido.dispatched_at, deliveredAt: pedido.delivered_at,
    cancelReason: pedido.cancel_reason, revision: pedido.revision, createdByName: pedido.created_by_name,
    createdAt: pedido.created_at, updatedAt: pedido.updated_at,
    itemCount: itens.length, quoteCount: cotacoes.length,
    // Comprado: o valor congelado no pedido. Antes disso, o da cotação escolhida ou a
    // menor completa — rotulado na tela como estimativa, nunca como gasto.
    totalCents: pedido.purchased_total_cents ?? escolhida?.totalCents ?? null,
    bestQuoteCents: comparativo.linhas.filter((l) => l.nota !== null).reduce<number | null>((menor, l) => menor === null || l.totalCents < menor ? l.totalCents : menor, null),
    referenceCents: comparativo.referenciaCents,
    partial: parcial,
    delivery: situacaoDaEntrega({ status: pedido.status, expectedDeliveryDate: pedido.expected_delivery_date, neededBy: pedido.needed_by, parcial }, hoje),
  };
}

export async function listarPedidos(context: OrganizationContext, filtro: { projectId?: string | null } = {}) {
  const { results } = await context.db.prepare(
    `SELECT ${colunasPedido} FROM purchase_requests r
     LEFT JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
     WHERE r.organization_id = ?1 AND (?2 IS NULL OR r.project_id = ?2)
     ORDER BY CASE r.status WHEN 'entregue' THEN 1 WHEN 'cancelado' THEN 2 ELSE 0 END, COALESCE(r.needed_by, '9999-12-31'), r.number DESC
     LIMIT 500`,
  ).bind(context.organization.id, filtro.projectId ?? null).all<PedidoRow>();
  const ids = results.map((r) => r.id);
  const itens = await itensDoPedido(context, ids);
  const { cotacoes, precos } = await cotacoesDoPedido(context, ids);
  const hoje = hojeDaEmpresa(context);
  return results.map((pedido) => {
    const meus = itens.filter((i) => i.request_id === pedido.id);
    const minhas = cotacoes.filter((q) => q.request_id === pedido.id);
    const comparativo = compararCotacoes(meus.map((i) => ({ id: i.id, description: i.description, quantity: Number(i.quantity), referenceCostCents: i.reference_cost_cents })), paraComparar(minhas, precos), hoje, pedido.needed_by);
    return resumoDoPedido(pedido, meus, comparativo, minhas, hoje);
  });
}

export async function detalharPedido(context: OrganizationContext, id: string) {
  const pedido = await carregarPedido(context, id);
  const itens = await itensDoPedido(context, [id]);
  const { cotacoes, precos } = await cotacoesDoPedido(context, [id]);
  const hoje = hojeDaEmpresa(context);
  const comparar = paraComparar(cotacoes, precos);
  const comparativo = compararCotacoes(itens.map((i) => ({ id: i.id, description: i.description, quantity: Number(i.quantity), referenceCostCents: i.reference_cost_cents })), comparar, hoje, pedido.needed_by);
  const eventos = await context.db.prepare(
    "SELECT id, kind, detail, author_name, created_at FROM purchase_events WHERE organization_id = ?1 AND request_id = ?2 ORDER BY created_at DESC, id DESC LIMIT 100",
  ).bind(context.organization.id, id).all<{ id: string; kind: string; detail: string; author_name: string; created_at: string }>();
  // Outros fornecedores possíveis: para pedir cotação enquanto orça, ou para trocar
  // quando a entrega atrasou ou ficou sem previsão. Exclui quem já cotou.
  const sugerir = await preparadorDeSugestoes(context);
  const alternativas = encerradaOuNao(pedido.status) ? [] : sugerir({
    productIds: itens.map((i) => i.product_id).filter((id): id is string => Boolean(id)),
    termos: [pedido.title, ...itens.map((i) => i.description)],
    excluir: cotacoes.map((q) => q.supplier_id),
  });
  return {
    alternatives: alternativas,
    request: resumoDoPedido(pedido, itens, comparativo, cotacoes, hoje),
    items: itens.map(itemJson),
    quotes: cotacoes.map((q) => ({
      id: q.id, supplierId: q.supplier_id, supplierName: q.supplier_name, supplierPhone: q.supplier_phone, supplierEmail: q.supplier_email,
      deliveryDays: Number(q.delivery_days), paymentTerms: q.payment_terms, paymentDays: Number(q.payment_days),
      freightCents: Number(q.freight_cents), discountCents: Number(q.discount_cents), validUntil: q.valid_until,
      negotiationScore: Number(q.negotiation_score), notes: q.notes, createdByName: q.created_by_name, updatedAt: q.updated_at,
      prices: comparar.find((c) => c.id === q.id)!.prices,
    })),
    comparison: comparativo,
    events: eventos.results.map((e) => ({ id: e.id, kind: e.kind, detail: e.detail, authorName: e.author_name, createdAt: e.created_at })),
    today: hoje,
  };
}

/** Total congelado no pedido: soma das linhas da cotação escolhida, mais frete, menos desconto. */
export async function totalDaCotacao(context: OrganizationContext, requestId: string, quoteId: string) {
  const cotacao = ensureFound(await context.db.prepare(
    "SELECT id, supplier_id, delivery_days, freight_cents, discount_cents, valid_until FROM purchase_quotes WHERE id = ?1 AND request_id = ?2 AND organization_id = ?3",
  ).bind(quoteId, requestId, context.organization.id).first<{ id: string; supplier_id: string; delivery_days: number; freight_cents: number; discount_cents: number; valid_until: string | null }>(), "Cotação");
  const itens = await itensDoPedido(context, [requestId]);
  const { results } = await context.db.prepare("SELECT request_item_id, unit_price_cents FROM purchase_quote_items WHERE quote_id = ?1 AND organization_id = ?2")
    .bind(quoteId, context.organization.id).all<{ request_item_id: string; unit_price_cents: number }>();
  const precos = new Map(results.map((r) => [r.request_item_id, Number(r.unit_price_cents)]));
  const faltando = itens.filter((item) => !precos.has(item.id));
  const subtotal = itens.reduce((soma, item) => soma + (precos.has(item.id) ? totalDaLinha(Number(item.quantity), precos.get(item.id)!) : 0), 0);
  return { cotacao, faltando, totalCents: Math.max(0, subtotal + Number(cotacao.freight_cents) - Number(cotacao.discount_cents)) };
}

export function eventoStatement(context: OrganizationContext, requestId: string, kind: string, detail: string) {
  return context.db.prepare("INSERT INTO purchase_events (id, organization_id, request_id, kind, detail, author_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(crypto.randomUUID(), context.organization.id, requestId, kind, detail, context.user.displayName, new Date().toISOString());
}

export async function exigirProjetoDaEmpresa(context: OrganizationContext, projectId: string | null) {
  if (!projectId) return null;
  const projeto = await context.db.prepare("SELECT id, name FROM projects WHERE id = ?1 AND organization_id = ?2")
    .bind(projectId, context.organization.id).first<{ id: string; name: string }>();
  if (!projeto) throw new ApiError(400, "project_not_found", "A obra informada não pertence a esta empresa.");
  return projeto;
}

// ── Catálogo: GOINFRA, SINAPI e a biblioteca da empresa ───────────────────────────────

export const FONTES_CATALOGO = ["goinfra", "sinapi", "biblioteca"] as const;
export type FonteCatalogo = typeof FONTES_CATALOGO[number];

export type ItemDeCatalogo = {
  source: FonteCatalogo; reference: string; code: string; description: string; unit: string;
  unitCostCents: number; label: string; category: string;
};

const escaparLike = (texto: string) => `%${texto.replace(/[\\%_]/g, "\\$&")}%`;

export async function tabelasGoinfra(context: Pick<OrganizationContext, "db">) {
  const { results } = await context.db.prepare(
    "SELECT id, referencia, tabela, regime, arquivo_nome, arquivo_sha256, arquivo_bytes, aba, total_itens, ignoradas, importado_por, importado_em FROM goinfra_tabelas WHERE tabela NOT LIKE 'importando-%' ORDER BY tabela, regime",
  ).all<{ id: string; referencia: string; tabela: TabelaGoinfra; regime: "Desonerado" | "NaoDesonerado"; arquivo_nome: string; arquivo_sha256: string; arquivo_bytes: number; aba: string; total_itens: number; ignoradas: number; importado_por: string; importado_em: number }>();
  return results;
}

const rotuloGoinfra = (t: { tabela: TabelaGoinfra; regime: "Desonerado" | "NaoDesonerado"; referencia: string }) =>
  `GOINFRA ${rotuloTabelaGoinfra[t.tabela] ?? t.tabela} · ${rotuloRegimeGoinfra[t.regime] ?? t.regime} · ${t.referencia.slice(5)}/${t.referencia.slice(0, 4)}`;

export async function buscarNoCatalogo(context: OrganizationContext, fonte: FonteCatalogo, busca: string, opcoes: { tabelaId?: string; uf?: string; regime?: string } = {}): Promise<{ items: ItemDeCatalogo[]; emptyReason: string | null }> {
  const termo = busca.trim();
  if (fonte === "goinfra") {
    const tabelas = await tabelasGoinfra(context);
    if (!tabelas.length) return { items: [], emptyReason: "Nenhuma tabela GOINFRA importada ainda. O superadministrador envia a planilha oficial no painel da plataforma." };
    const alvo = tabelas.filter((t) => !opcoes.tabelaId || t.id === opcoes.tabelaId);
    const items: ItemDeCatalogo[] = [];
    for (const tabela of alvo) {
      const { results } = await context.db.prepare(
        `SELECT codigo, descricao, unidade, custo_unitario_centavos FROM goinfra_itens
         WHERE tabela_id = ?1 AND (codigo = ?2 OR descricao LIKE ?3 ESCAPE '\\') ORDER BY descricao LIMIT 40`,
      ).bind(tabela.id, termo, escaparLike(termo)).all<{ codigo: string; descricao: string; unidade: string; custo_unitario_centavos: number }>();
      for (const item of results) items.push({
        source: "goinfra", reference: `GOINFRA:${tabela.tabela}:${tabela.regime}:${tabela.referencia}:${item.codigo}`,
        code: item.codigo, description: item.descricao, unit: item.unidade, unitCostCents: Number(item.custo_unitario_centavos),
        label: rotuloGoinfra(tabela), category: rotuloTabelaGoinfra[tabela.tabela] ?? "GOINFRA",
      });
    }
    return { items: items.slice(0, 60), emptyReason: items.length ? null : "Nenhum item da GOINFRA corresponde à busca." };
  }
  if (fonte === "sinapi") {
    const uf = opcoes.uf && /^[A-Z]{2}$/.test(opcoes.uf) ? opcoes.uf : DEFAULT_SINAPI_UF;
    const regime = opcoes.regime === "Desonerado" ? "Desonerado" : "NaoDesonerado";
    const ativa = await context.db.prepare("SELECT id, competencia FROM sinapi_competencias WHERE estado = 'aprovada' AND uf = ?1 AND regime = ?2 ORDER BY competencia DESC LIMIT 1")
      .bind(uf, regime).first<{ id: string; competencia: string }>();
    if (!ativa) return { items: [], emptyReason: `Não há referência SINAPI aprovada para ${uf} (${regime === "Desonerado" ? "desonerada" : "não desonerada"}).` };
    const { results } = await context.db.prepare(
      `SELECT codigo, descricao, unidade, custo_unitario_centavos, tipo FROM sinapi_itens
       WHERE competencia_id = ?1 AND (codigo = ?2 OR descricao LIKE ?3 ESCAPE '\\') ORDER BY tipo DESC, descricao LIMIT 50`,
    ).bind(ativa.id, termo, escaparLike(termo)).all<{ codigo: string; descricao: string; unidade: string; custo_unitario_centavos: number; tipo: string }>();
    return {
      items: results.map((item) => ({
        source: "sinapi" as const, reference: `SINAPI:${uf}:${ativa.competencia}:${regime}:${item.tipo}:${item.codigo}`,
        code: item.codigo, description: item.descricao, unit: item.unidade, unitCostCents: Number(item.custo_unitario_centavos),
        label: `SINAPI ${uf} · ${ativa.competencia.slice(5)}/${ativa.competencia.slice(0, 4)} · ${item.tipo === "insumo" ? "insumo" : "composição"}`,
        category: item.tipo === "insumo" ? "Insumo SINAPI" : "Composição SINAPI",
      })),
      emptyReason: results.length ? null : "Nenhum item da SINAPI corresponde à busca.",
    };
  }
  const { results } = await context.db.prepare(
    `SELECT id, code, description, category, unit, unit_cost_cents FROM budget_catalog_items
     WHERE organization_id = ?1 AND active = 1 AND (code LIKE ?2 ESCAPE '\\' OR description LIKE ?2 ESCAPE '\\' OR category LIKE ?2 ESCAPE '\\')
     ORDER BY category, description LIMIT 50`,
  ).bind(context.organization.id, escaparLike(termo)).all<{ id: string; code: string; description: string; category: string; unit: string; unit_cost_cents: number }>();
  return {
    items: results.map((item) => ({
      source: "biblioteca" as const, reference: `BIBLIOTECA:${item.id}`, code: item.code, description: item.description,
      unit: item.unit, unitCostCents: Number(item.unit_cost_cents), label: "Biblioteca de orçamentos da empresa", category: item.category,
    })),
    emptyReason: results.length ? null : "Nenhum item da biblioteca de orçamentos corresponde à busca.",
  };
}

/**
 * Resolve uma referência de catálogo no servidor. O preço e a descrição vêm sempre daqui,
 * nunca do navegador: a tela só diz qual item quer.
 */
export async function resolverReferencia(context: OrganizationContext, referencia: string): Promise<ItemDeCatalogo> {
  const partes = referencia.split(":");
  if (partes[0] === "GOINFRA" && partes.length === 5) {
    const [, tabela, regime, ref, codigo] = partes;
    const atual = await context.db.prepare("SELECT id, referencia, tabela, regime FROM goinfra_tabelas WHERE tabela = ?1 AND regime = ?2")
      .bind(tabela, regime).first<{ id: string; referencia: string; tabela: TabelaGoinfra; regime: "Desonerado" | "NaoDesonerado" }>();
    if (!atual) throw new ApiError(404, "catalog_item_not_found", "A tabela GOINFRA deste item não está mais disponível.");
    if (atual.referencia !== ref) throw new ApiError(409, "catalog_reference_replaced", "A tabela GOINFRA foi atualizada. Busque o item de novo para usar o preço vigente.");
    const item = await context.db.prepare("SELECT codigo, descricao, unidade, custo_unitario_centavos FROM goinfra_itens WHERE tabela_id = ?1 AND codigo = ?2")
      .bind(atual.id, codigo).first<{ codigo: string; descricao: string; unidade: string; custo_unitario_centavos: number }>();
    if (!item) throw new ApiError(404, "catalog_item_not_found", "Item GOINFRA não encontrado.");
    return { source: "goinfra", reference: referencia, code: item.codigo, description: item.descricao, unit: item.unidade, unitCostCents: Number(item.custo_unitario_centavos), label: rotuloGoinfra(atual), category: rotuloTabelaGoinfra[atual.tabela] ?? "GOINFRA" };
  }
  if (partes[0] === "SINAPI" && partes.length === 6) {
    const [, uf, competencia, regime, tipo, codigo] = partes;
    const item = await context.db.prepare(
      `SELECT i.codigo, i.descricao, i.unidade, i.custo_unitario_centavos FROM sinapi_itens i
       JOIN sinapi_competencias c ON c.id = i.competencia_id
       WHERE c.estado = 'aprovada' AND c.uf = ?1 AND c.competencia = ?2 AND c.regime = ?3 AND i.tipo = ?4 AND i.codigo = ?5`,
    ).bind(uf, competencia, regime, tipo, codigo).first<{ codigo: string; descricao: string; unidade: string; custo_unitario_centavos: number }>();
    if (!item) throw new ApiError(404, "catalog_item_not_found", "Item SINAPI não encontrado na referência aprovada.");
    return { source: "sinapi", reference: referencia, code: item.codigo, description: item.descricao, unit: item.unidade, unitCostCents: Number(item.custo_unitario_centavos), label: `SINAPI ${uf} · ${competencia.slice(5)}/${competencia.slice(0, 4)} · ${tipo === "insumo" ? "insumo" : "composição"}`, category: tipo === "insumo" ? "Insumo SINAPI" : "Composição SINAPI" };
  }
  if (partes[0] === "BIBLIOTECA" && partes.length === 2) {
    const item = await context.db.prepare("SELECT id, code, description, category, unit, unit_cost_cents FROM budget_catalog_items WHERE id = ?1 AND organization_id = ?2 AND active = 1")
      .bind(partes[1], context.organization.id).first<{ id: string; code: string; description: string; category: string; unit: string; unit_cost_cents: number }>();
    if (!item) throw new ApiError(404, "catalog_item_not_found", "Item da biblioteca não encontrado nesta empresa.");
    return { source: "biblioteca", reference: referencia, code: item.code, description: item.description, unit: item.unit, unitCostCents: Number(item.unit_cost_cents), label: "Biblioteca de orçamentos da empresa", category: item.category };
  }
  throw new ApiError(400, "invalid_catalog_reference", "Referência de catálogo inválida.");
}

/**
 * Guarda de revisão dentro do lote. O `UPDATE ... AND revision = ?` que abre o lote não
 * altera nada se outra pessoa gravou antes — mas as instruções seguintes (itens, eventos)
 * rodariam assim mesmo. Esta consulta falha quando a anterior não mudou linha nenhuma, e
 * a falha desfaz o lote inteiro. `abs()` do menor inteiro é o erro mais barato do SQLite.
 */
export function guardaDeRevisao(context: OrganizationContext) {
  return context.db.prepare("SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775808) ELSE 0 END AS guarda");
}

export async function gravarComRevisao(context: OrganizationContext, lote: ReturnType<OrganizationContext["db"]["prepare"]>[]) {
  try {
    await context.db.batch([lote[0], guardaDeRevisao(context), ...lote.slice(1)]);
  } catch (error) {
    if (/integer overflow/i.test(String(error)) || /integer overflow/i.test(String((error as { cause?: unknown })?.cause ?? ""))) {
      throw new ApiError(409, "revision_conflict", "Este pedido foi alterado por outra pessoa. Recarregue para ver a versão atual.");
    }
    throw error;
  }
}
