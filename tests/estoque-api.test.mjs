import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

// Estoque: entrada pelo recebimento da compra e manual, baixa que nunca deixa saldo
// negativo, mínimo por local e a lista de "Atenção" com outros fornecedores possíveis.

const h = await createHarness();
const lista = await h.load("/app/api/compras/route.ts");
const pedidoRota = await h.load("/app/api/compras/[requestId]/route.ts");
const cotacoes = await h.load("/app/api/compras/[requestId]/cotacoes/route.ts");
const acoes = await h.load("/app/api/compras/[requestId]/acoes/route.ts");
const fornecedores = await h.load("/app/api/compras/fornecedores/route.ts");
const produtos = await h.load("/app/api/compras/produtos/route.ts");
const estoque = await h.load("/app/api/compras/estoque/route.ts");
const movimentos = await h.load("/app/api/compras/estoque/movimentos/route.ts");
const minimos = await h.load("/app/api/compras/estoque/minimos/route.ts");
const lembretes = await h.load("/app/api/reminders/route.ts");

beforeEach(() => h.reset());
after(() => h.close());

const json = async (resposta) => { const r = await resposta; return { status: r.status, body: await r.json() }; };
const post = (rota, user, path, corpo, extra = {}, org = orgA) => json(rota.POST(h.request(user, path, { method: "POST", json: corpo, org }), extra));
const ler = (user = "owner", org = orgA) => json(estoque.GET(h.request(user, "/api/compras/estoque", { org })));
const mover = (corpo, user = "owner", org = orgA) => post(movimentos, user, "/api/compras/estoque/movimentos", { clientKey: crypto.randomUUID(), ...corpo }, {}, org);
const minimo = (corpo, user = "owner") => json(minimos.PUT(h.request(user, "/api/compras/estoque/minimos", { method: "PUT", json: corpo })));
const detalhe = (id) => json(pedidoRota.GET(h.request("owner", `/api/compras/${id}`), params({ requestId: id })));
const agir = (id, corpo) => post(acoes, "owner", `/api/compras/${id}/acoes`, corpo, params({ requestId: id }));

async function base() {
  const cimento = (await post(produtos, "owner", "/api/compras/produtos", { name: "Cimento CP-II 50 kg", unit: "sc", category: "Cimento" })).body.product;
  const deposito = (await post(fornecedores, "owner", "/api/compras/fornecedores", { name: "Depósito Um", categories: "Cimento, areia" })).body.supplier;
  const outro = (await post(fornecedores, "owner", "/api/compras/fornecedores", { name: "Casa Dois", categories: "Cimentos e argamassas" })).body.supplier;
  const alheio = (await post(fornecedores, "owner", "/api/compras/fornecedores", { name: "Elétrica Três", categories: "Fios, cabos" })).body.supplier;
  return { cimento, deposito, outro, alheio };
}

async function compraComprada({ cimento, deposito, outro }, previsao) {
  const criado = await post(lista, "owner", "/api/compras", { title: "Cimento da laje", projectId: "p-a", items: [{ productId: cimento.id, description: "Cimento", quantity: 100 }] });
  const id = criado.body.id;
  const item = (await detalhe(id)).body.items[0];
  await post(cotacoes, "owner", `/api/compras/${id}/cotacoes`, { supplierId: outro.id, deliveryDays: 9, prices: [{ itemId: item.id, unitPriceCents: 3_600 }] }, params({ requestId: id }));
  const q = await post(cotacoes, "owner", `/api/compras/${id}/cotacoes`, { supplierId: deposito.id, deliveryDays: 3, prices: [{ itemId: item.id, unitPriceCents: 3_300 }] }, params({ requestId: id }));
  const escolhida = q.body.quotes.find((c) => c.supplierId === deposito.id);
  const e = await agir(id, { action: "escolher", revision: q.body.request.revision, quoteId: escolhida.id });
  const c = await agir(id, { action: "comprar", revision: e.body.request.revision, ...(previsao === undefined ? {} : { expectedDeliveryDate: previsao }) });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  return { id, item, pedido: c.body };
}

test("recebimento da compra entra no estoque da obra, pelo preço comprado, e a baixa nunca fica negativa", async () => {
  const dados = await base();
  const { id, item, pedido } = await compraComprada(dados);
  const parte = await agir(id, { action: "receber", revision: pedido.request.revision, items: [{ itemId: item.id, quantity: 60 }] });
  assert.equal(parte.status, 200, JSON.stringify(parte.body));
  let atual = (await ler()).body;
  const saldo = atual.balances.find((b) => b.productId === dados.cimento.id && b.location === "p-a");
  assert.equal(saldo.balance, 60);
  assert.equal(saldo.locationName, "ARQ-1 · Casa Alfa");
  assert.deepEqual([atual.movements[0].source, atual.movements[0].unitCostCents, atual.movements[0].requestCode], ["compra", 3_300, "PC-0001"]);

  const semMotivo = await mover({ kind: "baixa", productId: dados.cimento.id, location: "p-a", quantity: 5 });
  assert.equal(semMotivo.status, 400, "baixa diz para onde foi o material");
  const demais = await mover({ kind: "baixa", productId: dados.cimento.id, location: "p-a", quantity: 61, note: "Concretagem da laje" });
  assert.equal(demais.status, 409);
  assert.match(demais.body.error, /Saldo de Cimento CP-II 50 kg neste local é 60 sc/);
  assert.equal((await mover({ kind: "baixa", productId: dados.cimento.id, location: "central", quantity: 1, note: "outro local" })).status, 409, "o saldo é por local");

  const chave = crypto.randomUUID();
  const baixa = await mover({ clientKey: chave, kind: "baixa", productId: dados.cimento.id, location: "p-a", quantity: 45.5, note: "Concretagem da laje" });
  assert.equal(baixa.status, 201);
  assert.equal(baixa.body.balance, 14.5);
  const repetida = await mover({ clientKey: chave, kind: "baixa", productId: dados.cimento.id, location: "p-a", quantity: 45.5, note: "Concretagem da laje" });
  assert.equal(repetida.body.replayed, true, "reenviar depois de falha de rede não baixa duas vezes");
  const entrada = await mover({ kind: "entrada", productId: dados.cimento.id, location: "central", quantity: 10, unitCostCents: 3_000, note: "Sobra da obra Beta" });
  assert.equal(entrada.status, 201);

  atual = (await ler()).body;
  assert.equal(atual.balances.find((b) => b.location === "p-a").balance, 14.5);
  assert.equal(atual.balances.find((b) => b.location === "central").balance, 10);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action LIKE 'stock.%'").get().n, 2);

  // Receber o resto entra o resto; o total recebido nunca passa do comprado.
  const resto = await agir(id, { action: "receber", revision: parte.body.request.revision, items: [{ itemId: item.id, quantity: 40 }] });
  assert.equal(resto.body.request.status, "entregue");
  assert.equal((await ler()).body.balances.find((b) => b.location === "p-a").balance, 54.5);
});

test("falta, mínimo e compra sem previsão entram em Atenção com outros fornecedores possíveis", async () => {
  const dados = await base();
  assert.equal((await minimo({ productId: dados.cimento.id, location: "p-a", minimum: 20 })).status, 200);
  let atencao = (await ler()).body.attention;
  const falta = atencao.find((a) => a.key === `estoque:${dados.cimento.id}:p-a`);
  assert.equal(falta.kind, "falta");
  assert.match(falta.detail, /Saldo 0 sc de mínimo 20 · nenhuma compra aberta/);
  assert.equal(falta.suggestedQuantity, 20);
  assert.deepEqual(falta.suggestions.map((s) => s.name).sort(), ["Casa Dois", "Depósito Um"], "categoria compatível; a elétrica fica de fora");

  const { id } = await compraComprada(dados, null);
  atencao = (await ler()).body.attention;
  const semPrevisao = atencao.find((a) => a.key === `entrega:${id}`);
  assert.equal(semPrevisao.kind, "sem_previsao");
  assert.match(semPrevisao.detail, /fornecedor não deu previsão/);
  assert.deepEqual(semPrevisao.suggestions.map((s) => s.name), ["Casa Dois"], "sugere quem já cotou, sem o fornecedor atual");
  assert.match(semPrevisao.suggestions[0].reason, /Já cotou este material: R\$\s?36,00 com entrega em 9 dias/);
  assert.match(atencao.find((a) => a.kind === "falta").detail, /PC-0001 sem previsão de entrega/);

  const agenda = (await json(lembretes.GET(h.request("owner", "/api/reminders")))).body.reminders;
  assert.ok(agenda.some((r) => r.group === "estoque" && /Em falta: Cimento/.test(r.title)));
  assert.ok(agenda.some((r) => r.group === "entrega" && /Entrega sem previsão/.test(r.title)));

  // O detalhe do pedido sugere quem ainda não cotou.
  const novo = await post(lista, "owner", "/api/compras", { title: "Mais cimento", items: [{ productId: dados.cimento.id, description: "Cimento", quantity: 10 }] });
  assert.deepEqual((await detalhe(novo.body.id)).body.alternatives.map((s) => s.name), ["Depósito Um", "Casa Dois"], "quem já cotou, do menor preço para o maior");

  assert.equal((await minimo({ productId: dados.cimento.id, location: "p-a", minimum: 0 })).status, 200);
  assert.ok(!(await ler()).body.attention.some((a) => a.kind === "falta"), "mínimo zero tira da vigilância");
});

test("estoque é da empresa e do perfil: outra empresa e leitura não movimentam", async () => {
  const { cimento } = await base();
  h.member("leitor", orgA, "Leo", "member", permissions({ purchases: { view: true, edit: false } }, false));
  assert.equal((await ler("leitor")).status, 200);
  assert.equal((await mover({ kind: "entrada", productId: cimento.id, location: "central", quantity: 1 }, "leitor")).status, 403);
  assert.equal((await mover({ kind: "entrada", productId: cimento.id, location: "central", quantity: 1 }, "owner-b", orgB)).status, 400, "produto de outra empresa");
  assert.equal((await mover({ kind: "entrada", productId: cimento.id, location: "p-b", quantity: 1 })).status, 400, "obra de outra empresa");
  assert.equal((await ler("owner-b", orgB)).body.balances.length, 0);
});
