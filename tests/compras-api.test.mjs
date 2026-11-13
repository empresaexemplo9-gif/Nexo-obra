import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

// Compras: o ciclo inteiro sobre o banco real em memória — orçar, comparar, escolher,
// comprar, acompanhar a entrega e receber — e as travas de empresa, permissão e revisão.

const h = await createHarness();
const lista = await h.load("/app/api/compras/route.ts");
const pedidoRota = await h.load("/app/api/compras/[requestId]/route.ts");
const cotacoes = await h.load("/app/api/compras/[requestId]/cotacoes/route.ts");
const cotacaoRota = await h.load("/app/api/compras/[requestId]/cotacoes/[quoteId]/route.ts");
const acoes = await h.load("/app/api/compras/[requestId]/acoes/route.ts");
const fornecedores = await h.load("/app/api/compras/fornecedores/route.ts");
const produtos = await h.load("/app/api/compras/produtos/route.ts");
const produtoRota = await h.load("/app/api/compras/produtos/[productId]/route.ts");
const catalogo = await h.load("/app/api/compras/catalogo/route.ts");
const lembretes = await h.load("/app/api/reminders/route.ts");
const { interpretarGoinfra } = await h.load("/lib/integrations/goinfra-planilha.ts");
const { compararCotacoes } = await h.load("/lib/compras.ts");
const superadmin = await h.load("/lib/server/superadmin.ts");
const goinfraRota = await h.load("/app/api/superadmin/goinfra/route.ts");
const goinfraCron = await h.load("/app/api/cron/goinfra/route.ts");
const goinfraBusca = await h.load("/lib/server/goinfra-sync.ts");
const { classificarArquivoGoinfra } = await h.load("/lib/integrations/goinfra-planilha.ts");
const ExcelJS = (await import("exceljs")).default;

beforeEach(() => h.reset());
after(() => h.close());

const json = async (response) => { const r = await response; return { status: r.status, body: await r.json() }; };
const post = (route, user, path, corpo, extra = {}, org = orgA) => route.POST(h.request(user, path, { method: "POST", json: corpo, org }), extra);
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dia = (dias) => new Date(Date.parse(`${hoje()}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

async function fornecedor(nome, extra = {}, user = "owner", org = orgA) {
  const r = await json(await post(fornecedores, user, "/api/compras/fornecedores", { name: nome, ...extra }, {}, org));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.supplier;
}
async function criarPedido(corpo, user = "owner", org = orgA) {
  return json(await post(lista, user, "/api/compras", corpo, {}, org));
}
const detalhe = async (id, user = "owner", org = orgA) => json(await pedidoRota.GET(h.request(user, `/api/compras/${id}`, { org }), params({ requestId: id })));
const cotar = async (id, corpo, user = "owner", org = orgA) => json(await post(cotacoes, user, `/api/compras/${id}/cotacoes`, corpo, params({ requestId: id }), org));
const agir = async (id, corpo, user = "owner", org = orgA) => json(await post(acoes, user, `/api/compras/${id}/acoes`, corpo, params({ requestId: id }), org));

async function pedidoComDuasCotacoes() {
  const barato = await fornecedor("Depósito Barato", { document: "11.222.333/0001-81", negotiationScore: 2 });
  const rapido = await fornecedor("Casa Rápida", { negotiationScore: 5 });
  const criado = await criarPedido({ title: "Cimento e areia — fundação", projectId: "p-a", neededBy: dia(5), items: [
    { description: "Cimento CP-II 50 kg", unit: "sc", quantity: 100 },
    { description: "Areia média", unit: "m³", quantity: 8.5 },
  ] });
  assert.equal(criado.status, 201, JSON.stringify(criado.body));
  assert.equal(criado.body.code, "PC-0001");
  const id = criado.body.id;
  const { body } = await detalhe(id);
  const [cimento, areia] = body.items;
  const q1 = await cotar(id, { supplierId: barato.id, deliveryDays: 10, paymentDays: 28, prices: [{ itemId: cimento.id, unitPriceCents: 3_200 }, { itemId: areia.id, unitPriceCents: 12_000 }] });
  assert.equal(q1.status, 201, JSON.stringify(q1.body));
  const q2 = await cotar(id, { supplierId: rapido.id, deliveryDays: 2, freightCents: 15_000, prices: [{ itemId: cimento.id, unitPriceCents: 3_400 }, { itemId: areia.id, unitPriceCents: 11_500 }] });
  assert.equal(q2.status, 201);
  return { id, barato, rapido, cimento, areia, detalhe: q2.body };
}

test("ciclo completo: cotar, comparar, escolher, comprar, despachar e receber em partes", async () => {
  const { id, barato, rapido, cimento, areia, detalhe: comparado } = await pedidoComDuasCotacoes();
  const linhas = comparado.comparison.linhas;
  const deBarato = linhas.find((l) => l.supplierId === barato.id);
  const deRapido = linhas.find((l) => l.supplierId === rapido.id);
  assert.equal(deBarato.totalCents, 100 * 3_200 + 102_000);
  assert.equal(deRapido.totalCents, 100 * 3_400 + 97_750 + 15_000);
  assert.ok(deBarato.menorPreco && !deRapido.menorPreco);
  assert.ok(deRapido.menorPrazo);
  assert.equal(deBarato.chegaATempo, false, "10 dias não chega até a necessidade em 5");
  assert.ok(deRapido.recomendada, "recomenda quem chega a tempo, mesmo um pouco mais caro");
  assert.equal(comparado.comparison.totalItemAItemCents, 320_000 + 97_750);

  const escolha = await agir(id, { action: "escolher", revision: comparado.request.revision, quoteId: deRapido.quoteId });
  assert.equal(escolha.status, 200, JSON.stringify(escolha.body));
  assert.equal(escolha.body.request.status, "a_comprar");
  assert.equal(escolha.body.request.supplierName, "Casa Rápida");

  const travado = await json(await pedidoRota.PATCH(h.request("owner", `/api/compras/${id}`, { method: "PATCH", json: { revision: escolha.body.request.revision, items: [] } }), params({ requestId: id })));
  assert.equal(travado.status, 409, "itens não mudam depois da escolha");

  const compra = await agir(id, { action: "comprar", revision: escolha.body.request.revision, orderNumber: "NF-778" });
  assert.equal(compra.status, 200, JSON.stringify(compra.body));
  assert.equal(compra.body.request.status, "comprado");
  assert.equal(compra.body.request.totalCents, deRapido.totalCents, "total congelado no pedido");
  assert.equal(compra.body.request.expectedDeliveryDate, dia(2));

  const bloqueada = await cotar(id, { supplierId: barato.id, deliveryDays: 1, prices: [{ itemId: cimento.id, unitPriceCents: 1 }] });
  assert.equal(bloqueada.status, 409, "cotação não muda depois do pedido");

  const envio = await agir(id, { action: "despachar", revision: compra.body.request.revision, carrier: "Transportadora Goiás", trackingCode: "TG123" });
  assert.equal(envio.body.request.status, "em_entrega");
  assert.equal(envio.body.request.carrier, "Transportadora Goiás");

  const demais = await agir(id, { action: "receber", revision: envio.body.request.revision, items: [{ itemId: cimento.id, quantity: 101 }] });
  assert.equal(demais.status, 400, "não recebe mais do que foi comprado");

  const parte = await agir(id, { action: "receber", revision: envio.body.request.revision, items: [{ itemId: cimento.id, quantity: 100 }, { itemId: areia.id, quantity: 4 }] });
  assert.equal(parte.status, 200, JSON.stringify(parte.body));
  assert.equal(parte.body.request.status, "em_entrega");
  assert.equal(parte.body.request.partial, true);

  const resto = await agir(id, { action: "receber", revision: parte.body.request.revision, items: [{ itemId: areia.id, quantity: 4.5 }] });
  assert.equal(resto.body.request.status, "entregue");
  assert.equal(resto.body.request.deliveredAt, hoje());
  assert.deepEqual(resto.body.events.map((e) => e.kind).slice(0, 4), ["entregue", "recebido_parcial", "despachado", "comprado"]);

  const { body } = await json(await fornecedores.GET(h.request("owner", "/api/compras/fornecedores")));
  const stats = body.suppliers.find((s) => s.id === rapido.id).stats;
  assert.deepEqual({ quotes: stats.quotes, won: stats.won, delivered: stats.delivered, onTime: stats.onTime, purchased: stats.purchasedCents }, { quotes: 1, won: 1, delivered: 1, onTime: 1, purchased: deRapido.totalCents });
  assert.ok(Number(h.db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action LIKE 'purchase_request.%'").get().n) >= 5);
});

test("cotação incompleta ou vencida não é escolhida; corrigir a escolhida reabre a escolha", async () => {
  const { id, barato, cimento } = await pedidoComDuasCotacoes();
  const meia = await fornecedor("Meia Cotação");
  const incompleta = await cotar(id, { supplierId: meia.id, deliveryDays: 1, prices: [{ itemId: cimento.id, unitPriceCents: 100 }] });
  const linha = incompleta.body.comparison.linhas.find((l) => l.supplierId === meia.id);
  assert.equal(linha.completa, false);
  assert.equal(linha.nota, null, "cotação parcial não concorre");
  const recusada = await agir(id, { action: "escolher", revision: incompleta.body.request.revision, quoteId: linha.quoteId });
  assert.equal(recusada.status, 400);
  assert.match(recusada.body.error, /não tem preço para 1 item/);

  const atual = (await detalhe(id)).body;
  const doBarato = atual.quotes.find((q) => q.supplierId === barato.id);
  const escolhida = await agir(id, { action: "escolher", revision: atual.request.revision, quoteId: doBarato.id });
  assert.equal(escolhida.body.request.status, "a_comprar");
  const apagar = (quoteId) => json(cotacaoRota.DELETE(h.request("owner", `/api/compras/${id}/cotacoes/${quoteId}`, { method: "DELETE" }), params({ requestId: id, quoteId })));
  assert.equal((await apagar(doBarato.id)).status, 409, "a cotação escolhida não é excluída");
  const semMeia = await apagar(linha.quoteId);
  assert.equal(semMeia.status, 200);
  assert.ok(!semMeia.body.quotes.some((q) => q.id === linha.quoteId));
  const precos = Object.entries(doBarato.prices).map(([itemId, unitPriceCents]) => ({ itemId, unitPriceCents: unitPriceCents + 50 }));
  const corrigida = await cotar(id, { supplierId: barato.id, deliveryDays: 10, prices: precos });
  assert.equal(corrigida.status, 200, "reenviar substitui, não duplica");
  assert.equal(corrigida.body.quotes.filter((q) => q.supplierId === barato.id).length, 1);
  assert.equal(corrigida.body.request.status, "a_orcar");
  assert.equal(corrigida.body.request.selectedQuoteId, null);

  const vencedor = await fornecedor("Validade Curta");
  const itens = corrigida.body.items.map((item) => ({ itemId: item.id, unitPriceCents: 10 }));
  const vencida = await cotar(id, { supplierId: vencedor.id, deliveryDays: 1, validUntil: dia(-1), prices: itens });
  const linhaVencida = vencida.body.comparison.linhas.find((l) => l.supplierId === vencedor.id);
  assert.equal(linhaVencida.vencida, true);
  assert.equal((await agir(id, { action: "escolher", revision: vencida.body.request.revision, quoteId: linhaVencida.quoteId })).status, 400);
});

test("revisão antiga é recusada sem aplicar nada do lote", async () => {
  const { id, detalhe: atual } = await pedidoComDuasCotacoes();
  const revisao = atual.request.revision;
  const primeira = await json(await pedidoRota.PATCH(h.request("owner", `/api/compras/${id}`, { method: "PATCH", json: { revision: revisao, title: "Fundação — bloco A" } }), params({ requestId: id })));
  assert.equal(primeira.status, 200);
  const atrasada = await json(await pedidoRota.PATCH(h.request("owner", `/api/compras/${id}`, { method: "PATCH", json: { revision: revisao, title: "Outro nome", items: [{ description: "Brita 1", unit: "m³", quantity: 3 }] } }), params({ requestId: id })));
  assert.equal(atrasada.status, 409);
  const depois = (await detalhe(id)).body;
  assert.equal(depois.request.title, "Fundação — bloco A");
  assert.equal(depois.items.length, 2, "os itens da gravação recusada não entraram");
});

test("outra empresa não vê, não cota e não usa fornecedor, obra ou pedido alheio", async () => {
  const { id, barato } = await pedidoComDuasCotacoes();
  assert.equal((await json(await lista.GET(h.request("owner-b", "/api/compras", { org: orgB })))).body.requests.length, 0);
  assert.equal((await detalhe(id, "owner-b", orgB)).status, 404);
  assert.equal((await agir(id, { action: "cancelar", revision: 1, reason: "teste" }, "owner-b", orgB)).status, 404);
  assert.equal((await criarPedido({ title: "Pedido B", projectId: "p-a" }, "owner-b", orgB)).status, 400, "obra de outra empresa");
  const pedidoB = await criarPedido({ title: "Pedido B", items: [{ description: "Tinta", quantity: 2 }] }, "owner-b", orgB);
  assert.equal(pedidoB.body.code, "PC-0001", "numeração é por empresa");
  const itemB = (await detalhe(pedidoB.body.id, "owner-b", orgB)).body.items[0];
  const alheio = await cotar(pedidoB.body.id, { supplierId: barato.id, deliveryDays: 1, prices: [{ itemId: itemB.id, unitPriceCents: 1 }] }, "owner-b", orgB);
  assert.equal(alheio.status, 400);
  assert.equal(alheio.body.code, "supplier_not_found");
  assert.equal((await json(await fornecedores.GET(h.request("owner-b", "/api/compras/fornecedores", { org: orgB })))).body.suppliers.length, 0);
});

test("sem edição em Compras só consulta; sem leitura, nada", async () => {
  h.member("leitor", orgA, "Leo", "member", permissions({ purchases: { view: true, edit: false } }, false));
  h.member("sem", orgA, "Sem", "member", permissions({}, false));
  const { id } = await pedidoComDuasCotacoes();
  assert.equal((await detalhe(id, "leitor")).status, 200);
  assert.equal((await criarPedido({ title: "Tentativa" }, "leitor")).status, 403);
  assert.equal((await agir(id, { action: "cancelar", revision: 3, reason: "não posso" }, "leitor")).status, 403);
  assert.equal((await json(await post(fornecedores, "leitor", "/api/compras/fornecedores", { name: "X" }))).status, 403);
  assert.equal((await json(await lista.GET(h.request("sem", "/api/compras")))).status, 403);
  // Copiar itens de orçamento exige leitura de Orçamentos.
  h.member("comprador", orgA, "Cris", "member", permissions({ purchases: { view: true, edit: true } }, false));
  h.db.sqlite.prepare("INSERT INTO budget_versions (id, organization_id, project_id, code, version, status, created_at, updated_at) VALUES ('11111111-aaaa-4aaa-8aaa-111111111111', ?, 'p-a', 'ORC-1', 1, 'approved', '', '')").run(orgA);
  h.db.sqlite.prepare("INSERT INTO budget_items (id, budget_version_id, sort_order, description, unit, quantity, unit_cost_cents) VALUES ('bi-1', '11111111-aaaa-4aaa-8aaa-111111111111', 0, 'Bloco cerâmico 9x19x29', 'mil', 4, 98000), ('bi-2', '11111111-aaaa-4aaa-8aaa-111111111111', 1, 'Argamassa', 'sc', 30, 2500)").run();
  assert.equal((await criarPedido({ title: "Do orçamento", budgetVersionId: "11111111-aaaa-4aaa-8aaa-111111111111" }, "comprador")).status, 403);
  const copiado = await criarPedido({ title: "Do orçamento", budgetVersionId: "11111111-aaaa-4aaa-8aaa-111111111111" });
  assert.equal(copiado.status, 201);
  const itens = (await detalhe(copiado.body.id)).body;
  assert.equal(itens.request.projectId, "p-a", "a obra vem do orçamento");
  assert.deepEqual(itens.items.map((i) => [i.description, i.quantity, i.referenceCostCents]), [["Bloco cerâmico 9x19x29", 4, 98000], ["Argamassa", 30, 2500]]);
});

test("entrega atrasada e compra sem pedido perto da necessidade viram lembrete", async () => {
  const { id, detalhe: atual } = await pedidoComDuasCotacoes();
  await criarPedido({ title: "Tinta acrílica", neededBy: dia(1), items: [{ description: "Tinta 18 L", quantity: 4 }] });
  const linha = atual.comparison.linhas.find((l) => l.recomendada);
  const escolhido = await agir(id, { action: "escolher", revision: atual.request.revision, quoteId: linha.quoteId });
  await agir(id, { action: "comprar", revision: escolhido.body.request.revision, orderedAt: dia(-5), expectedDeliveryDate: dia(-1) });
  const agenda = (await json(await lembretes.GET(h.request("owner", "/api/reminders")))).body;
  const entrega = agenda.reminders.find((r) => r.group === "entrega");
  assert.equal(entrega.severity, "atrasado");
  assert.match(entrega.title, /Entrega atrasada/);
  assert.ok(agenda.reminders.some((r) => r.group === "compra" && /Tinta acrílica/.test(r.title)));
});

const planilhaCsv = [
  "AGÊNCIA GOIANA DE INFRAESTRUTURA E TRANSPORTES",
  "TABELA DE PREÇOS DE OBRAS CIVIS — REFERÊNCIA 09/2026",
  "",
  "CÓDIGO;DESCRIÇÃO;UNID.;PREÇO UNITÁRIO (R$)",
  "01;SERVIÇOS PRELIMINARES;;",
  ...Array.from({ length: 12 }, (_, i) => `0100${i + 10};Item de teste ${i + 1};m²;${(i + 1) * 10},5${i % 10}`),
  "020001;CIMENTO PORTLAND CP-II-E-32 (SACO 50 KG);SC;\"1.234,56\"",
  "TOTAL;;;",
].join("\n");

test("GOINFRA: lê a planilha pelo cabeçalho, ativa a tabela e alimenta o cadastro com preço do servidor", async () => {
  const lido = interpretarGoinfra(Buffer.from(planilhaCsv, "utf8"), "goinfra-obras-civis.csv");
  assert.equal(lido.itens.length, 13);
  assert.equal(lido.ignoradas, 2, "título de grupo e total ficam fora");
  assert.deepEqual(lido.itens.at(-1), { codigo: "020001", descricao: "CIMENTO PORTLAND CP-II-E-32 (SACO 50 KG)", unidade: "SC", custoUnitarioCentavos: 123_456 });
  assert.throws(() => interpretarGoinfra(Buffer.from("A;B\n1;2", "utf8"), "x.csv"), /cabeçalho/);

  Object.assign(h.runtime, { SUPERADMIN_EMAIL: "admin@example.test", SUPERADMIN_PASSWORD_HASH: "test-only", SUPERADMIN_SESSION_SECRET: "test-only-shared-secret-at-least-32-characters" });
  const cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
  const envio = (referencia) => {
    const form = new FormData();
    form.set("referencia", referencia); form.set("tabela", "obras-civis"); form.set("regime", "Desonerado");
    form.set("arquivo", new File([planilhaCsv], "goinfra-obras-civis.csv", { type: "text/csv" }));
    return new Request("https://platform.test/api/superadmin/goinfra", { method: "PUT", headers: { cookie, origin: "https://platform.test" }, body: form });
  };
  const semSessao = new Request("https://platform.test/api/superadmin/goinfra", { method: "PUT", headers: { origin: "https://platform.test" }, body: new FormData() });
  assert.equal((await goinfraRota.PUT(semSessao)).status, 401, "empresa não importa referência global");
  const importado = await json(await goinfraRota.PUT(envio("2026-09")));
  assert.equal(importado.status, 200, JSON.stringify(importado.body));
  assert.equal(importado.body.tables[0].totalItens, 13);
  assert.equal(importado.body.report.linhaDoCabecalho, 4);

  const busca = await json(await catalogo.GET(h.request("owner", "/api/compras/catalogo?fonte=goinfra&q=cimento")));
  assert.equal(busca.body.items.length, 1);
  const item = busca.body.items[0];
  assert.equal(item.reference, "GOINFRA:obras-civis:Desonerado:2026-09:020001");
  assert.equal(item.unitCostCents, 123_456);

  const criado = await json(await post(produtos, "owner", "/api/compras/produtos", { reference: item.reference }));
  assert.equal(criado.status, 201, JSON.stringify(criado.body));
  assert.equal(criado.body.product.referenceCostCents, 123_456, "o preço vem da tabela, não do navegador");
  assert.equal(criado.body.product.source, "goinfra");
  const repetido = await json(await post(produtos, "owner", "/api/compras/produtos", { reference: item.reference }));
  assert.equal(repetido.body.product.id, criado.body.product.id, "importar de novo não duplica");
  const forjado = await json(await post(produtos, "owner", "/api/compras/produtos", { reference: item.reference, referenceCostCents: 1 }));
  assert.equal(forjado.status, 400, "campo de preço junto da referência é recusado");

  // Pedido com o produto do catálogo herda o custo de referência para a comparação.
  const pedido = await criarPedido({ title: "Cimento", items: [{ productId: criado.body.product.id, description: "Cimento", unit: "un", quantity: 10 }] });
  const aberto = (await detalhe(pedido.body.id)).body;
  assert.equal(aberto.items[0].referenceCostCents, 123_456);
  assert.equal(aberto.items[0].unit, "SC", "unidade vem do cadastro");
  const loja = await fornecedor("Loja");
  const cotado = await cotar(pedido.body.id, { supplierId: loja.id, deliveryDays: 3, prices: [{ itemId: aberto.items[0].id, unitPriceCents: 135_802 }] });
  assert.equal(cotado.body.comparison.linhas[0].diferencaReferenciaPercent, 10);
  const historico = await json(await produtoRota.GET(h.request("owner", `/api/compras/produtos/${criado.body.product.id}`), params({ productId: criado.body.product.id })));
  assert.equal(historico.body.history[0].supplierName, "Loja");

  // Nova referência substitui a anterior; o item buscado na tabela velha pede nova busca.
  assert.equal((await goinfraRota.PUT(envio("2026-08"))).status, 422, "referência mais antiga não volta");
  assert.equal((await json(await goinfraRota.PUT(envio("2026-10")))).body.tables.length, 1);
  const velho = await json(await post(produtos, "owner", "/api/compras/produtos", { reference: "GOINFRA:obras-civis:Desonerado:2026-09:010010" }));
  assert.equal(velho.status, 409);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) n FROM goinfra_itens").get().n, 13, "os itens da tabela anterior saíram");
});

async function planilhaComAbas(abas) {
  const livro = new ExcelJS.Workbook();
  for (const [nome, linhas] of Object.entries(abas)) livro.addWorksheet(nome).addRows(linhas);
  return Buffer.from(await livro.xlsx.writeBuffer());
}
const itensDe = (prefixo, n) => Array.from({ length: n }, (_, i) => [`${prefixo}${String(i + 1).padStart(3, "0")}`, `Serviço ${prefixo} ${i + 1}`, "m²", (i + 1) * 3.25]);

test("GOINFRA: todas as abas da planilha entram, sem item faltando nem repetido", async () => {
  const bytes = await planilhaComAbas({
    "Capa": [["AGÊNCIA GOIANA DE INFRAESTRUTURA E TRANSPORTES"], ["Tabela 291"]],
    "Preliminares": [["TABELA 291"], [], ["CÓDIGO", "DESCRIÇÃO", "UNID.", "PREÇO UNITÁRIO (R$)"], ...itensDe("01", 8)],
    "Estrutura": [["Código", "Descrição do serviço", "Unidade", "Custo unitário"], ...itensDe("02", 7), ["01001", "repetido em outra aba", "m²", 1]],
  });
  const lido = interpretarGoinfra(bytes, "goinfra.xlsx");
  assert.equal(lido.itens.length, 15, "8 da primeira aba + 7 da segunda");
  assert.equal(lido.aba, "Preliminares, Estrutura");
  assert.deepEqual(lido.abas.map((a) => [a.aba, a.itens]), [["Capa", 0], ["Preliminares", 8], ["Estrutura", 7]]);
  assert.equal(lido.ignoradas, 1, "código repetido entre abas conta como ignorado");
  assert.throws(() => interpretarGoinfra(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), "velho.xls"), /XLS antigo/);
});

test("GOINFRA: o nome do arquivo diz tabela, mês e regime; o que não diz fica de fora", () => {
  assert.deepEqual(classificarArquivoGoinfra("OBRAS CIVIS - TABELA 291 - FEVEREIRO-2025 - COM DESONERAÇÃO - Publicada em 05-05-2025.xlsx"), { tabela: "obras-civis", regime: "Desonerado", referencia: "2025-02" });
  assert.deepEqual(classificarArquivoGoinfra("Tabela de Insumos Mão de Obra - MAIO-2023 - SEM DESONERAÇÃO.xlsx"), { tabela: "insumos-mao-de-obra", regime: "NaoDesonerado", referencia: "2023-05" });
  assert.deepEqual(classificarArquivoGoinfra("Tabela%20de%20Insumos%20Materiais%20-%20ABRIL-2025%20-%20COM%20DESONERA%C3%87%C3%83O.xlsx"), { tabela: "insumos-materiais", regime: "Desonerado", referencia: "2025-04" });
  assert.equal(classificarArquivoGoinfra("OBRAS CIVIS - TABELA 291 - COM DESONERAÇÃO.xlsx"), null, "sem mês não se adivinha");
  assert.equal(classificarArquivoGoinfra("relatorio-anual-2025.xlsx"), null);
});

test("GOINFRA: busca automática importa a referência mais nova de cada tabela e preserva a ativa na falha", async () => {
  const site = "https://goias.gov.br/goinfra";
  const obras = await planilhaComAbas({ "Grupo 1": [["CÓDIGO", "DESCRIÇÃO", "UNID.", "PREÇO UNITÁRIO"], ...itensDe("01", 10)], "Grupo 2": [["CÓDIGO", "DESCRIÇÃO", "UNID.", "PREÇO UNITÁRIO"], ...itensDe("02", 6)] });
  const materiais = await planilhaComAbas({ Materiais: [["CÓDIGO", "DESCRIÇÃO DO INSUMO", "UNIDADE", "PREÇO"], ...itensDe("M", 12)] });
  const arquivo = (nome) => `${site}/wp-content/uploads/sites/77/tabela-de-composicao/118/arquivos/${encodeURIComponent(nome)}`;
  const paginas = {
    [`${site}/tabelas/`]: `<a href="${site}/tabela-de-composicao/118/">Obras civis</a> <a href="https://example.com/fora.xlsx">fora</a>`,
    [`${site}/tabela-de-composicao/118/`]: [
      `<a href="${arquivo("OBRAS CIVIS - TABELA 290 - JANEIRO-2025 - COM DESONERAÇÃO.xlsx")}">antiga</a>`,
      `<a href="${arquivo("OBRAS CIVIS - TABELA 291 - FEVEREIRO-2025 - COM DESONERAÇÃO.xlsx")}">nova</a>`,
      `<a href="${arquivo("Tabela de Insumos Materiais - ABRIL-2025 - SEM DESONERAÇÃO.xlsx")}">insumos</a>`,
      `<a href="${arquivo("OBRAS CIVIS - TABELA 291 - FEVEREIRO-2025 - SEM DESONERAÇÃO.xlsx")}">quebrada</a>`,
      `<a href="${arquivo("OBRAS CIVIS - TABELA 291 - FEVEREIRO-2025 - SEM DESONERAÇÃO.xls")}">xls</a>`,
    ].join("\n"),
  };
  const pedidos = [];
  const io = { async buscar(url) {
    pedidos.push(url);
    if (paginas[url]) return { bytes: Buffer.from(paginas[url]), tipo: "text/html" };
    if (url.includes("FEVEREIRO-2025%20-%20COM")) return { bytes: obras, tipo: "" };
    if (url.includes("Materiais")) return { bytes: materiais, tipo: "" };
    throw new Error("o portal respondeu HTTP 404");
  } };

  await assert.rejects(goinfraBusca.buscarGoinfra("teste", io), (e) => e.status === 503, "sem página configurada não busca");
  Object.assign(h.runtime, { GOINFRA_INDICE_URL: "https://example.com/tabelas/" });
  await assert.rejects(goinfraBusca.buscarGoinfra("teste", io), (e) => e.status === 503, "host fora do portal é recusado");
  Object.assign(h.runtime, { GOINFRA_INDICE_URL: `${site}/tabelas/`, CRON_SECRET: "segredo-de-teste-com-mais-de-32-caracteres" });

  const r = await goinfraBusca.buscarGoinfra("teste", io);
  assert.ok(!pedidos.some((u) => u.startsWith("https://example.com")), "nunca sai do portal");
  assert.ok(!pedidos.some((u) => u.includes("JANEIRO")), "a referência antiga nem é baixada");
  assert.equal(r.xlsIgnorados, 1);
  const por = Object.fromEntries(r.tabelas.map((t) => [`${t.tabela}|${t.regime}`, t]));
  assert.equal(por["obras-civis|Desonerado"].situacao, "importada");
  assert.equal(por["obras-civis|Desonerado"].itens, 16, "as duas abas entram");
  assert.equal(por["obras-civis|Desonerado"].abas, 2);
  assert.equal(por["insumos-materiais|NaoDesonerado"].itens, 12);
  assert.equal(por["obras-civis|NaoDesonerado"].situacao, "falhou");
  const ativas = h.db.sqlite.prepare("SELECT tabela, regime, referencia, total_itens FROM goinfra_tabelas ORDER BY tabela").all();
  assert.deepEqual(ativas.map((t) => [t.tabela, t.regime, t.referencia, t.total_itens]), [["insumos-materiais", "NaoDesonerado", "2025-04", 12], ["obras-civis", "Desonerado", "2025-02", 16]]);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) n FROM goinfra_itens").get().n, 28);
  assert.match(h.db.sqlite.prepare("SELECT last_error FROM goinfra_sync").get().last_error, /404/, "a falha fica registrada");

  // Cron: sem o segredo é recusado; com ele, nada novo → tudo "atual", sem baixar planilha.
  assert.equal((await goinfraCron.GET(new Request("https://platform.test/api/cron/goinfra"))).status, 401);
  pedidos.length = 0;
  const segunda = await goinfraBusca.buscarGoinfra("teste", io);
  assert.equal(segunda.tabelas.find((t) => t.tabela === "obras-civis" && t.regime === "Desonerado").situacao, "atual");
  assert.ok(!pedidos.some((u) => u.includes("Materiais")), "tabela já ativa não é baixada de novo");
  const catalogoGoinfra = await json(await catalogo.GET(h.request("owner", "/api/compras/catalogo?fonte=goinfra&q=Serviço M 12")));
  assert.equal(catalogoGoinfra.status, 200);
});

test("comparativo: pesos, empate e item a item", () => {
  const itens = [{ id: "a", description: "A", quantity: 2, referenceCostCents: 100 }, { id: "b", description: "B", quantity: 1, referenceCostCents: 100 }];
  const base = { paymentDays: 0, freightCents: 0, discountCents: 0, negotiationScore: 3, validUntil: null };
  const r = compararCotacoes(itens, [
    { ...base, id: "q1", supplierId: "s1", supplierName: "Um", deliveryDays: 5, prices: { a: 90, b: 200 } },
    { ...base, id: "q2", supplierId: "s2", supplierName: "Dois", deliveryDays: 5, prices: { a: 150, b: 80 } },
  ], "2026-11-12", null);
  assert.equal(r.referenciaCents, 300);
  assert.equal(r.totalItemAItemCents, 180 + 80);
  assert.equal(r.melhorPorItem.a.quoteId, "q1");
  assert.equal(r.linhas[0].nota, r.linhas[1].nota, "380 contra 380: empate em preço, prazo e negociação");
  assert.ok(r.linhas.every((l) => l.menorPreco));
});
