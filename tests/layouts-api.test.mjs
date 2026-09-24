import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

const h = await createHarness();
const lista = await h.load("/app/api/layouts/route.ts");
const item = await h.load("/app/api/layouts/[layoutId]/route.ts");
const layout = await h.load("/lib/layout.ts");
const { CATALOGO } = await h.load("/lib/layout-catalogo.ts");

beforeEach(() => h.reset());
after(() => h.close());

const json = async (response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() });
async function create(user, corpo, org = orgA) { return json(await lista.POST(h.request(user, "/api/layouts", { method: "POST", json: corpo, org }))); }
async function open(user, id, org = orgA) { return json(await item.GET(h.request(user, `/api/layouts/${id}`, { org }), params({ layoutId: id }))); }
async function save(user, id, corpo, org = orgA) { return json(await item.PUT(h.request(user, `/api/layouts/${id}`, { method: "PUT", json: corpo, org }), params({ layoutId: id }))); }

test("cria layout a partir do modelo com garagem, salva e reabre igual", async () => {
  const created = await create("owner", { name: "Casa Alfa — proposta", projectId: "p-a", modelo: "casa-garagem" });
  assert.equal(created.status, 201);
  const aberto = created.body.layout;
  assert.equal(aberto.projectCode, "ARQ-1");
  assert.equal(aberto.revision, 1);
  assert.ok(aberto.content.itens.some((i) => i.catalogo === "carro-seda"));
  assert.ok(aberto.content.aberturas.some((a) => a.tipo === "portao"));
  assert.ok(aberto.areaM2 > 80);

  const conteudo = structuredClone(aberto.content);
  conteudo.itens.push(layout.itemNovo("moto", 12000, 4000));
  const saved = await save("owner", aberto.id, { name: "Casa Alfa — v2", projectId: "p-a", revision: 1, content: conteudo });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.layout.revision, 2);
  const reaberto = await open("owner", aberto.id);
  assert.deepEqual(reaberto.body.layout.content, conteudo);
  assert.equal(reaberto.body.layout.name, "Casa Alfa — v2");
});

test("salvar com revisão antiga não sobrescreve o trabalho de outra pessoa", async () => {
  h.member("socia", orgA, "Sônia Sócia", "admin");
  const { body } = await create("owner", { name: "Apto", modelo: "apartamento" });
  const id = body.layout.id;
  const primeiro = await save("socia", id, { name: "Apto", revision: 1, content: body.layout.content });
  assert.equal(primeiro.status, 200);
  const atrasado = await save("owner", id, { name: "Apto", revision: 1, content: layout.layoutVazio() });
  assert.equal(atrasado.status, 409);
  assert.match(atrasado.body.error, /Sônia Sócia salvou este layout/);
  assert.ok((await open("owner", id)).body.layout.content.paredes.length > 0, "o conteúdo da sócia continua lá");
});

test("outra empresa não lista, não abre, não salva e não exclui", async () => {
  const { body } = await create("owner", { name: "Interno", modelo: "vazio" });
  const id = body.layout.id;
  assert.equal((await json(await lista.GET(h.request("owner-b", "/api/layouts", { org: orgB })))).body.layouts.length, 0);
  assert.equal((await open("owner-b", id, orgB)).status, 404);
  assert.equal((await save("owner-b", id, { name: "x", revision: 1, content: layout.layoutVazio() }, orgB)).status, 404);
  const removido = await item.DELETE(h.request("owner-b", `/api/layouts/${id}`, { method: "DELETE", org: orgB }), params({ layoutId: id }));
  assert.equal(removido.status, 404);
  assert.equal((await create("owner-b", { name: "x", projectId: "p-a" }, orgB)).status, 400, "projeto de outra empresa é recusado");
  assert.equal((await create("owner-b", { name: "x", duplicarDe: id }, orgB)).status, 404, "não duplica layout de outra empresa");
});

test("sem edição na Prancheta só consulta; sem leitura, nada", async () => {
  h.member("leitor", orgA, "Leo", "member", permissions({ studio: { view: true, edit: false } }, false));
  h.member("sem", orgA, "Sem", "member", permissions({}, false));
  const { body } = await create("owner", { name: "Proposta", modelo: "apartamento" });
  assert.equal((await open("leitor", body.layout.id)).status, 200);
  assert.equal((await create("leitor", { name: "x" })).status, 403);
  assert.equal((await save("leitor", body.layout.id, { name: "x", revision: 1, content: body.layout.content })).status, 403);
  assert.equal((await open("sem", body.layout.id)).status, 403);
});

test("conteúdo inválido é recusado na borda do servidor", async () => {
  const { body } = await create("owner", { name: "Teste", modelo: "vazio" });
  const id = body.layout.id;
  const base = layout.layoutVazio();
  const invalidos = [
    { ...base, itens: [{ ...layout.itemNovo("sofa-3", 0, 0), catalogo: "nave-espacial" }] },
    { ...base, aberturas: [{ id: "ab-1", paredeId: "nao-existe", tipo: "porta", posicao: 100, largura: 800, altura: 2100, peitoril: 0, inverter: false }] },
    { ...base, paredes: [{ id: "pa-1", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, espessura: 150, altura: 2800 }], aberturas: [{ id: "ab-1", paredeId: "pa-1", tipo: "portao", posicao: 500, largura: 3000, altura: 2300, peitoril: 0, inverter: false }] },
    { ...base, itens: [{ ...layout.itemNovo("cadeira", 0, 0), x: 9e9 }] },
    { ...base, extra: true },
  ];
  for (const content of invalidos) {
    const response = await save("owner", id, { name: "Teste", revision: 1, content });
    assert.equal(response.status, 400, JSON.stringify(content).slice(0, 120));
  }
});

test("duplicar copia o conteúdo e excluir registra na auditoria", async () => {
  const { body } = await create("owner", { name: "Original", modelo: "casa-garagem" });
  const copia = await create("owner", { name: "Cópia", duplicarDe: body.layout.id });
  assert.deepEqual(copia.body.layout.content, body.layout.content);
  const removido = await item.DELETE(h.request("owner", `/api/layouts/${body.layout.id}`, { method: "DELETE" }), params({ layoutId: body.layout.id }));
  assert.equal(removido.status, 204);
  const acoes = h.db.sqlite.prepare("SELECT action FROM audit_events ORDER BY created_at").all().map((row) => row.action);
  assert.deepEqual(acoes, ["layout.created", "layout.created", "layout.deleted"]);
});

test("paredes com porta e janela viram os pedaços certos para levantar em 3D", () => {
  const parede = { id: "p", a: { x: 0, y: 0 }, b: { x: 5000, y: 0 }, espessura: 150, altura: 2800 };
  const aberturas = [
    { id: "a1", paredeId: "p", tipo: "porta", posicao: 1000, largura: 800, altura: 2100, peitoril: 0, inverter: false },
    { id: "a2", paredeId: "p", tipo: "janela", posicao: 3500, largura: 1200, altura: 1200, peitoril: 1000, inverter: false },
  ];
  assert.deepEqual(layout.pedacosDaParede(parede, aberturas), [
    { inicio: 0, fim: 600, base: 0, topo: 2800 },
    { inicio: 600, fim: 1400, base: 2100, topo: 2800 },
    { inicio: 1400, fim: 2900, base: 0, topo: 2800 },
    { inicio: 2900, fim: 4100, base: 0, topo: 1000 },
    { inicio: 2900, fim: 4100, base: 2200, topo: 2800 },
    { inicio: 4100, fim: 5000, base: 0, topo: 2800 },
  ]);
});

test("cômodos vizinhos não duplicam a parede da divisa", () => {
  const doc = layout.layoutVazio();
  layout.adicionarParedes(doc, layout.comodoRetangular(0, 0, 4000, 3000).paredes);
  layout.adicionarParedes(doc, layout.comodoRetangular(4000, -1000, 7000, 3000).paredes);
  const naDivisa = doc.paredes.filter((p) => p.a.x === 4000 && p.b.x === 4000);
  const coberto = naDivisa.reduce((soma, p) => soma + layout.comprimentoDaParede(p), 0);
  assert.equal(coberto, 4000, "3000 do primeiro cômodo + só 1000 novos do segundo");
  assert.equal(layout.areaM2(layout.comodoRetangular(0, 0, 4000, 3000).comodo.pontos), 12);
});

test("porta posta pelo clique cai na parede certa e não passa da ponta", () => {
  const doc = layout.layoutVazio();
  layout.adicionarParedes(doc, layout.comodoRetangular(0, 0, 3000, 3000).paredes);
  const porta = layout.abrirNoPonto(doc, { x: 100, y: 20 }, "porta");
  assert.equal(porta.largura, 800);
  assert.equal(porta.posicao, 400, "encostada no canto, não para fora da parede");
  assert.equal(layout.abrirNoPonto(doc, { x: 1500, y: 1500 }, "janela"), null, "no meio do cômodo não há parede");
});

test("todo item do catálogo tem medida plausível e os modelos são válidos", () => {
  const ids = new Set();
  for (const entrada of CATALOGO) {
    assert.ok(!ids.has(entrada.id), `id repetido ${entrada.id}`); ids.add(entrada.id);
    assert.ok(entrada.largura >= 50 && entrada.profundidade >= 50 && entrada.altura >= 1, entrada.id);
    assert.match(entrada.cor, /^#[0-9a-f]{6}$/i);
  }
  for (const modelo of layout.MODELOS) assert.doesNotThrow(() => layout.layoutDoModelo(modelo.id), modelo.id);
});

test("acabamento só entre os que o item aceita, e o escolhido volta igual", async () => {
  for (const entrada of CATALOGO) {
    if (!entrada.materiais) { assert.equal(entrada.material, undefined, entrada.id); continue; }
    assert.ok(entrada.materiais.length > 0 && entrada.materiais.includes(entrada.material), entrada.id);
    assert.equal(layout.itemNovo(entrada.id, 0, 0).material, entrada.material, entrada.id);
  }
  const { body } = await create("owner", { name: "Acabamentos", modelo: "vazio" });
  const base = layout.layoutVazio();
  const mesa = { ...layout.itemNovo("mesa-6", 0, 0), material: "vidro" };
  const balcao = { ...layout.itemNovo("balcao-alvenaria", 3000, 0), material: "marmore" };
  const salvo = await save("owner", body.layout.id, { name: "Acabamentos", revision: 1, content: { ...base, itens: [mesa, balcao] } });
  assert.equal(salvo.status, 200, JSON.stringify(salvo.body));
  const reaberto = await open("owner", body.layout.id);
  assert.deepEqual(reaberto.body.layout.content.itens.map((i) => i.material), ["vidro", "marmore"]);
  for (const errado of [{ ...layout.itemNovo("sofa-3", 0, 0), material: "vidro" }, { ...layout.itemNovo("mesa-4", 0, 0), material: "concreto" }, { ...layout.itemNovo("mesa-4", 0, 0), material: "ouro" }]) {
    const recusado = await save("owner", body.layout.id, { name: "Acabamentos", revision: 2, content: { ...base, itens: [errado] } });
    assert.equal(recusado.status, 400, errado.catalogo);
  }
});

test("todo item do catálogo desenha em planta e monta em 3D, em cada acabamento", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { SimboloItem } = await h.load("/components/layout/simbolos-2d.tsx");
  const { montarCena } = await h.load("/components/layout/cena-3d.ts");
  const three = await import("three");
  const { materialDoItem } = await h.load("/lib/layout-catalogo.ts");
  const categorias = new Set(CATALOGO.map((c) => c.categoria));
  assert.ok(categorias.has("balcoes") && categorias.has("alvenaria"));
  const doc = layout.layoutVazio();
  for (const entrada of CATALOGO) {
    for (const material of entrada.materiais ?? [null]) {
      const svg = renderToStaticMarkup(createElement("svg", null, createElement(SimboloItem, { forma: entrada.forma, variante: entrada.variante, w: entrada.largura, d: entrada.profundidade, cor: entrada.cor, material })));
      assert.doesNotMatch(svg, /NaN|undefined/, `${entrada.id} ${material}`);
      assert.equal(materialDoItem(entrada, material), material);
      const novo = layout.itemNovo(entrada.id, 0, 0);
      if (material) novo.material = material;
      doc.itens.push(novo);
    }
  }
  const cena = montarCena(three, layout.layoutConteudoSchema.parse(doc));
  let malhas = 0;
  cena.traverse((objeto) => {
    if (!objeto.isMesh) return;
    malhas += 1;
    const posicao = objeto.geometry.getAttribute("position");
    for (let i = 0; i < posicao.array.length; i += 1) assert.ok(Number.isFinite(posicao.array[i]), objeto.parent?.uuid);
  });
  assert.equal(cena.children.length, doc.itens.length);
  assert.ok(malhas > doc.itens.length * 2);
});
