import type { OrganizationContext } from "@/lib/server/backend";
import { listarFornecedores } from "@/lib/server/compras-cadastros";
import { usageDayKey } from "@/lib/server/usage";
import { numeroDoPedido } from "@/lib/compras";

// Estoque e "Atenção". O saldo é sempre a soma dos movimentos; nada aqui guarda número
// calculado. A atenção junta dois sinais reais: material abaixo do mínimo no local, e
// compra comprada sem previsão de entrega ou com a previsão vencida.

export const CENTRAL = "central";
export const localDe = (projectId: string | null) => projectId ?? CENTRAL;

type Saldo = { product_id: string; location: string; balance: number; last_at: string | null };

export async function saldos(context: OrganizationContext) {
  const { results } = await context.db.prepare(
    `SELECT product_id, COALESCE(project_id, 'central') AS location, SUM(quantity) AS balance, MAX(occurred_on) AS last_at
     FROM stock_movements WHERE organization_id = ?1 GROUP BY product_id, COALESCE(project_id, 'central')`,
  ).bind(context.organization.id).all<Saldo>();
  return results.map((s) => ({ ...s, balance: Math.round(Number(s.balance) * 1000) / 1000 }));
}

export async function saldoDe(context: OrganizationContext, productId: string, projectId: string | null) {
  const linha = await context.db.prepare(
    "SELECT COALESCE(SUM(quantity), 0) AS balance FROM stock_movements WHERE organization_id = ?1 AND product_id = ?2 AND COALESCE(project_id, 'central') = ?3",
  ).bind(context.organization.id, productId, localDe(projectId)).first<{ balance: number }>();
  return Math.round(Number(linha?.balance ?? 0) * 1000) / 1000;
}

async function minimos(context: OrganizationContext) {
  const { results } = await context.db.prepare("SELECT product_id, location, minimum FROM stock_minimums WHERE organization_id = ?1 AND minimum > 0")
    .bind(context.organization.id).all<{ product_id: string; location: string; minimum: number }>();
  return results;
}

/** Produtos em falta ou abaixo do mínimo, só com dois SELECTs — usado também nos lembretes. */
export async function faltasDeEstoque(context: OrganizationContext) {
  const [todos, limites] = await Promise.all([saldos(context), minimos(context)]);
  const porChave = new Map(todos.map((s) => [`${s.product_id}|${s.location}`, s.balance]));
  return limites.map((m) => ({ productId: m.product_id, location: m.location, minimum: Number(m.minimum), balance: porChave.get(`${m.product_id}|${m.location}`) ?? 0 }))
    .filter((f) => f.balance < f.minimum);
}

// ── Sugestão de outros fornecedores ─────────────────────────────────────────────────
//
// Duas fontes, nesta ordem: quem já cotou o mesmo produto para a empresa (com o preço e o
// prazo que deu), e quem declara no cadastro que fornece aquela categoria ou material.
// Nada é inventado: sem histórico nem categoria parecida, a lista vem vazia e a tela diz.

const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PALAVRAS_VAZIAS = new Set(["para", "com", "sem", "tipo", "barra", "saco", "metro", "unidade", "geral", "material", "materiais"]);

export type Sugestao = {
  supplierId: string; name: string; phone: string; email: string; reason: string;
  lastPriceCents: number | null; deliveryDays: number | null; onTime: number; delivered: number;
};

export async function preparadorDeSugestoes(context: OrganizationContext) {
  const fornecedores = (await listarFornecedores(context)).filter((f) => f.active);
  const { results: cotados } = await context.db.prepare(
    `SELECT i.product_id, q.supplier_id, qi.unit_price_cents, q.delivery_days, q.updated_at
     FROM purchase_quote_items qi
     JOIN purchase_quotes q ON q.id = qi.quote_id AND q.organization_id = qi.organization_id
     JOIN purchase_request_items i ON i.id = qi.request_item_id AND i.organization_id = qi.organization_id
     WHERE qi.organization_id = ?1 AND i.product_id IS NOT NULL ORDER BY q.updated_at DESC`,
  ).bind(context.organization.id).all<{ product_id: string; supplier_id: string; unit_price_cents: number; delivery_days: number }>();

  // Item parecido na lista de preços que a loja enviou: as duas palavras mais longas do
  // nome do material precisam aparecer na descrição do item da lista. O SQLite não ignora
  // acento, então o banco pré-filtra pelo maior trecho sem acento da palavra mais longa e a
  // comparação final é feita aqui, sem acento dos dois lados.
  async function porLista(nomes: string[], fora: Set<string>, ja: Set<string>): Promise<Sugestao[]> {
    const lista: Sugestao[] = [];
    for (const nome of nomes.slice(0, 6)) {
      const originais = nome.split(/[^\p{L}\p{N}]+/u).filter((p) => {
        const n = normalizar(p);
        return n.length >= 4 && !/^\d+$/.test(n) && !PALAVRAS_VAZIAS.has(n);
      }).sort((a, b) => b.length - a.length).slice(0, 2);
      if (!originais.length) continue;
      const trecho = originais[0].split(/[^A-Za-z0-9]+/).sort((a, b) => b.length - a.length)[0] ?? "";
      if (trecho.length < 4) continue;
      const exigidas = originais.map(normalizar);
      const { results } = await context.db.prepare(
        `SELECT i.supplier_id, i.description, i.unit, i.price_cents, l.valid_on FROM supplier_price_items i
         JOIN supplier_price_lists l ON l.id = i.list_id AND l.organization_id = i.organization_id
         WHERE i.organization_id = ?1 AND i.description LIKE ?2 ORDER BY i.price_cents LIMIT 200`,
      ).bind(context.organization.id, `%${trecho}%`).all<{ supplier_id: string; description: string; unit: string; price_cents: number; valid_on: string }>();
      for (const linha of results) {
        if (fora.has(linha.supplier_id) || ja.has(linha.supplier_id) || lista.some((l) => l.supplierId === linha.supplier_id)) continue;
        const descricao = normalizar(linha.description);
        if (!exigidas.every((palavra) => descricao.includes(palavra))) continue;
        const f = fornecedores.find((x) => x.id === linha.supplier_id);
        if (!f) continue;
        lista.push({
          supplierId: f.id, name: f.name, phone: f.phone, email: f.email,
          reason: `Lista de preços de ${linha.valid_on.split("-").reverse().join("/")}: ${linha.description} a ${(Number(linha.price_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/${linha.unit}`,
          lastPriceCents: Number(linha.price_cents), deliveryDays: f.leadTimeDays, onTime: f.stats.onTime, delivered: f.stats.delivered,
        });
      }
    }
    return lista;
  }

  return async (alvo: { productIds: string[]; termos: string[]; nomes?: string[]; categoria?: string; excluir: string[] }): Promise<Sugestao[]> => {
    const fora = new Set(alvo.excluir);
    const escolhidos = new Map<string, Sugestao>();
    const taxa = (s: Sugestao) => s.delivered ? s.onTime / s.delivered : 0.5;
    // Último preço que cada fornecedor deu para algum dos produtos.
    for (const linha of cotados) {
      if (!alvo.productIds.includes(linha.product_id) || fora.has(linha.supplier_id) || escolhidos.has(linha.supplier_id)) continue;
      const f = fornecedores.find((x) => x.id === linha.supplier_id);
      if (!f) continue;
      escolhidos.set(f.id, {
        supplierId: f.id, name: f.name, phone: f.phone, email: f.email,
        reason: `Já cotou este material: ${(Number(linha.unit_price_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} com entrega em ${linha.delivery_days} dias`,
        lastPriceCents: Number(linha.unit_price_cents), deliveryDays: Number(linha.delivery_days), onTime: f.stats.onTime, delivered: f.stats.delivered,
      });
    }
    const porHistorico = [...escolhidos.values()].sort((a, b) => taxa(b) - taxa(a) || (a.lastPriceCents ?? 0) - (b.lastPriceCents ?? 0));
    const daLista = await porLista(alvo.nomes ?? alvo.termos, fora, new Set(escolhidos.keys()));
    for (const s of daLista) escolhidos.set(s.supplierId, s);

    const termos = [...new Set(alvo.termos.flatMap((t) => normalizar(t).split(/[^a-z0-9]+/)).filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p)))];
    const porCategoria: Sugestao[] = [];
    if (termos.length) for (const f of fornecedores) {
      if (fora.has(f.id) || escolhidos.has(f.id) || !f.categories) continue;
      const categorias = normalizar(f.categories);
      // Palavra do material no cadastro do fornecedor, ou a categoria do produto inteira.
      const categoriaInteira = alvo.categoria && normalizar(alvo.categoria) !== "geral" && categorias.includes(normalizar(alvo.categoria));
      const casou = categoriaInteira || termos.find((t) => categorias.includes(t) || (t.length > 5 && categorias.includes(t.slice(0, -1))));
      if (!casou) continue;
      porCategoria.push({
        supplierId: f.id, name: f.name, phone: f.phone, email: f.email, reason: `Fornece ${f.categories}`,
        lastPriceCents: null, deliveryDays: f.leadTimeDays, onTime: f.stats.onTime, delivered: f.stats.delivered,
      });
    }
    porCategoria.sort((a, b) => taxa(b) - taxa(a));
    return [...porHistorico, ...daLista, ...porCategoria].slice(0, 4);
  };
}

// ── Atenção ────────────────────────────────────────────────────────────────────────

type Produto = { id: string; name: string; unit: string; category: string };
type Projeto = { id: string; code: string; name: string };

export async function produtosEProjetos(context: OrganizationContext) {
  const [produtos, projetos] = await Promise.all([
    context.db.prepare("SELECT id, name, unit, category, active FROM purchase_products WHERE organization_id = ?1").bind(context.organization.id).all<Produto & { active: number }>(),
    context.db.prepare("SELECT id, code, name FROM projects WHERE organization_id = ?1").bind(context.organization.id).all<Projeto>(),
  ]);
  return { produtos: produtos.results, projetos: projetos.results };
}

export const nomeDoLocal = (location: string, projetos: Projeto[]) => {
  if (location === CENTRAL) return "Depósito central";
  const p = projetos.find((x) => x.id === location);
  return p ? `${p.code} · ${p.name}` : "Obra removida";
};

export async function itensDeAtencao(context: OrganizationContext) {
  const hoje = usageDayKey(Date.now(), context.organization.timezone);
  const [faltas, { produtos, projetos }, sugerir] = await Promise.all([faltasDeEstoque(context), produtosEProjetos(context), preparadorDeSugestoes(context)]);

  // Compras abertas que trazem cada produto para cada local.
  const { results: abertos } = await context.db.prepare(
    `SELECT r.id, r.number, r.status, r.expected_delivery_date, r.needed_by, COALESCE(r.project_id, 'central') AS location, i.product_id,
       i.quantity - i.received_quantity AS pending, q.supplier_id
     FROM purchase_request_items i
     JOIN purchase_requests r ON r.id = i.request_id AND r.organization_id = i.organization_id
     LEFT JOIN purchase_quotes q ON q.id = r.selected_quote_id AND q.organization_id = r.organization_id
     WHERE i.organization_id = ?1 AND r.status IN ('a_orcar', 'a_comprar', 'comprado', 'em_entrega') AND i.quantity > i.received_quantity`,
  ).bind(context.organization.id).all<{ id: string; number: number; status: string; expected_delivery_date: string | null; needed_by: string | null; location: string; product_id: string | null; pending: number; supplier_id: string | null }>();

  const itens: Array<{
    key: string; kind: "falta" | "abaixo" | "sem_previsao" | "atrasada"; title: string; detail: string; locationName: string;
    productId: string | null; location: string | null; requestId: string | null; requestCode: string | null; suggestions: Sugestao[];
    suggestedQuantity: number | null; unit: string | null;
  }> = [];

  for (const falta of faltas) {
    const produto = produtos.find((p) => p.id === falta.productId);
    if (!produto) continue;
    const compra = abertos.find((a) => a.product_id === falta.productId && a.location === falta.location);
    const situacao = !compra ? "nenhuma compra aberta"
      : compra.status === "a_orcar" || compra.status === "a_comprar" ? `${numeroDoPedido(compra.number)} ainda não comprado`
      : !compra.expected_delivery_date ? `${numeroDoPedido(compra.number)} sem previsão de entrega`
      : compra.expected_delivery_date < hoje ? `${numeroDoPedido(compra.number)} atrasado desde ${compra.expected_delivery_date.split("-").reverse().join("/")}`
      : `${numeroDoPedido(compra.number)} chega ${compra.expected_delivery_date.split("-").reverse().join("/")}`;
    const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    itens.push({
      key: `estoque:${falta.productId}:${falta.location}`, kind: falta.balance <= 0 ? "falta" : "abaixo",
      title: produto.name, locationName: nomeDoLocal(falta.location, projetos),
      detail: `Saldo ${fmt(falta.balance)} ${produto.unit} de mínimo ${fmt(falta.minimum)} · ${situacao}`,
      productId: produto.id, location: falta.location, requestId: compra?.id ?? null, requestCode: compra ? numeroDoPedido(compra.number) : null,
      suggestions: await sugerir({ productIds: [produto.id], termos: [produto.name], categoria: produto.category, nomes: [produto.name], excluir: compra?.supplier_id ? [compra.supplier_id] : [] }),
      suggestedQuantity: compra ? null : Math.max(0, Math.round((falta.minimum - falta.balance) * 1000) / 1000), unit: produto.unit,
    });
  }

  // Compra feita sem previsão, ou com previsão vencida: o material está em falta na obra
  // até alguém cobrar o fornecedor ou trocar de fornecedor.
  const pedidos = new Map<string, typeof abertos>();
  for (const linha of abertos) if (linha.status === "comprado" || linha.status === "em_entrega") pedidos.set(linha.id, [...(pedidos.get(linha.id) ?? []), linha]);
  if (pedidos.size) {
    const marcadores = [...pedidos.keys()].map((_, i) => `?${i + 2}`).join(",");
    const { results: descricoes } = await context.db.prepare(
      `SELECT r.id, r.title, i.description FROM purchase_requests r JOIN purchase_request_items i ON i.request_id = r.id AND i.organization_id = r.organization_id
       WHERE r.organization_id = ?1 AND r.id IN (${marcadores})`,
    ).bind(context.organization.id, ...pedidos.keys()).all<{ id: string; title: string; description: string }>();
    for (const [id, linhas] of pedidos) {
      const base = linhas[0];
      const sem = !base.expected_delivery_date;
      if (!sem && base.expected_delivery_date! >= hoje) continue;
      const titulo = descricoes.find((d) => d.id === id)?.title ?? numeroDoPedido(base.number);
      itens.push({
        key: `entrega:${id}`, kind: sem ? "sem_previsao" : "atrasada", title: titulo, locationName: nomeDoLocal(base.location, projetos),
        detail: `${numeroDoPedido(base.number)} · ${linhas.length} ${linhas.length === 1 ? "item pendente" : "itens pendentes"} · ${sem ? "fornecedor não deu previsão" : `previsão era ${base.expected_delivery_date!.split("-").reverse().join("/")}`}${base.needed_by ? ` · obra precisa em ${base.needed_by.split("-").reverse().join("/")}` : ""}`,
        productId: null, location: base.location, requestId: id, requestCode: numeroDoPedido(base.number),
        suggestions: await sugerir({ productIds: linhas.map((l) => l.product_id).filter((p): p is string => Boolean(p)), termos: descricoes.filter((d) => d.id === id).map((d) => d.description), excluir: base.supplier_id ? [base.supplier_id] : [] }),
        suggestedQuantity: null, unit: null,
      });
    }
  }
  const ordem = { falta: 0, atrasada: 1, sem_previsao: 2, abaixo: 3 };
  return itens.sort((a, b) => ordem[a.kind] - ordem[b.kind]);
}
