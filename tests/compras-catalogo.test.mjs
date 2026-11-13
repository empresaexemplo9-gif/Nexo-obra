import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params } from "./helpers/api-harness.mjs";

// Catálogo de materiais padrão (ABNT), verificação do fornecedor na Receita e lista de
// preços enviada pela loja. A resposta da BrasilAPI é simulada com dados anonimizados;
// nada deste arquivo chega ao runtime.

const h = await createHarness();
const fornecedores = await h.load("/app/api/compras/fornecedores/route.ts");
const cnpjRota = await h.load("/app/api/compras/fornecedores/cnpj/route.ts");
const receitaRota = await h.load("/app/api/compras/fornecedores/[supplierId]/receita/route.ts");
const listaRota = await h.load("/app/api/compras/fornecedores/[supplierId]/lista/route.ts");
const produtos = await h.load("/app/api/compras/produtos/route.ts");
const catalogo = await h.load("/app/api/compras/catalogo/route.ts");
const estoque = await h.load("/app/api/compras/estoque/route.ts");
const minimos = await h.load("/app/api/compras/estoque/minimos/route.ts");
const { MATERIAIS_PADRAO } = await h.load("/lib/catalogo-materiais.ts");
const { cnpjValido } = await h.load("/lib/integrations/cnpj.ts");

const fetchOriginal = globalThis.fetch;
beforeEach(() => { h.reset(); globalThis.fetch = fetchOriginal; });
after(() => { globalThis.fetch = fetchOriginal; return h.close(); });

const json = async (resposta) => { const r = await resposta; return { status: r.status, body: await r.json() }; };
const post = (rota, path, corpo, extra = {}, user = "owner", org = orgA) => json(rota.POST(h.request(user, path, { method: "POST", json: corpo, org }), extra));
const buscar = (fonte, q, user = "owner", org = orgA) => json(catalogo.GET(h.request(user, `/api/compras/catalogo?fonte=${fonte}&q=${encodeURIComponent(q)}`, { org })));

const CNPJ = "33000167000101";
const respostaReceita = { cnpj: CNPJ, razao_social: "EMPRESA DE TESTE MATERIAIS LTDA", nome_fantasia: "LOJA TESTE", descricao_situacao_cadastral: "ATIVA",
  cnae_fiscal_descricao: "Comércio varejista de materiais de construção em geral", municipio: "GOIANIA", uf: "GO", ddd_telefone_1: "6232120000", email: "CONTATO@EXEMPLO.TEST" };

test("materiais padrão: cada item tem norma, unidade e especificação, e entra no cadastro sem preço inventado", async () => {
  assert.ok(MATERIAIS_PADRAO.length >= 50);
  assert.equal(new Set(MATERIAIS_PADRAO.map((m) => m.codigo)).size, MATERIAIS_PADRAO.length, "códigos únicos");
  for (const m of MATERIAIS_PADRAO) {
    assert.match(m.norma, /^ABNT NBR /, m.codigo);
    assert.ok(m.unidade && m.especificacao.length > 20, m.codigo);
    assert.ok(!("preco" in m) && !/R\$/.test(m.especificacao), "sem preço no catálogo");
  }
  const achado = await buscar("padrao", "vergalhão 10");
  assert.equal(achado.status, 200);
  const barra = achado.body.items.find((i) => i.code === "MAT-044");
  assert.match(barra.specification, /CA-50.*500 MPa.*0,617 kg\/m/);
  assert.equal(barra.unitCostCents, null);
  assert.equal((await buscar("padrao", "NBR 16697")).body.items.length, 6, "busca pela norma");

  const criado = await post(produtos, "/api/compras/produtos", { reference: barra.reference });
  assert.equal(criado.status, 201, JSON.stringify(criado.body));
  assert.deepEqual([criado.body.product.source, criado.body.product.referenceCostCents, criado.body.product.referenceLabel, criado.body.product.unit], ["padrao", null, "ABNT NBR 7480", "br"]);
  assert.match(criado.body.product.specification, /massa nominal 0,617 kg\/m/);
  assert.equal((await post(produtos, "/api/compras/produtos", { reference: "PADRAO:MAT-999" })).status, 404);
});

test("CNPJ: a Receita preenche o cadastro e a verificação é gravada só pelo servidor", async () => {
  assert.equal(cnpjValido(CNPJ), true);
  assert.equal(cnpjValido("33000167000102"), false);
  const pedidos = [];
  globalThis.fetch = async (url) => { pedidos.push(String(url)); return Response.json(respostaReceita); };
  const consulta = await json(cnpjRota.GET(h.request("owner", `/api/compras/fornecedores/cnpj?cnpj=33.000.167/0001-01`)));
  assert.equal(consulta.status, 200, JSON.stringify(consulta.body));
  assert.deepEqual(consulta.body.registry, { cnpj: CNPJ, razaoSocial: "EMPRESA DE TESTE MATERIAIS LTDA", nomeFantasia: "LOJA TESTE", situacao: "ATIVA", atividade: "Comércio varejista de materiais de construção em geral", municipio: "Goiania", uf: "GO", telefone: "(62) 3212-0000", email: "contato@exemplo.test" });
  assert.equal(pedidos[0], `https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`);
  assert.equal((await json(cnpjRota.GET(h.request("owner", "/api/compras/fornecedores/cnpj?cnpj=33000167000102")))).status, 400, "dígito errado nem consulta");
  assert.equal(pedidos.length, 1);

  const loja = (await post(fornecedores, "/api/compras/fornecedores", { name: "Loja Teste", document: CNPJ })).body.supplier;
  assert.equal(loja.registry, null, "cadastrar não é verificar");
  const conferido = await post(receitaRota, `/api/compras/fornecedores/${loja.id}/receita`, {}, params({ supplierId: loja.id }));
  assert.equal(conferido.status, 200);
  assert.equal(conferido.body.supplier.registry.status, "ATIVA");
  assert.equal(conferido.body.supplier.registry.name, "EMPRESA DE TESTE MATERIAIS LTDA");

  // Falha, CNPJ inexistente e resposta de outro CNPJ nunca viram cadastro verificado.
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  assert.equal((await post(receitaRota, `/api/compras/fornecedores/${loja.id}/receita`, {}, params({ supplierId: loja.id }))).status, 404);
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  assert.equal((await post(receitaRota, `/api/compras/fornecedores/${loja.id}/receita`, {}, params({ supplierId: loja.id }))).status, 503);
  globalThis.fetch = async () => Response.json({ ...respostaReceita, cnpj: "11222333000181" });
  assert.equal((await json(cnpjRota.GET(h.request("owner", `/api/compras/fornecedores/cnpj?cnpj=${CNPJ}`)))).status, 502);
  globalThis.fetch = async () => Response.json({ ...respostaReceita, descricao_situacao_cadastral: "BAIXADA" });
  assert.equal((await post(receitaRota, `/api/compras/fornecedores/${loja.id}/receita`, {}, params({ supplierId: loja.id }))).body.supplier.registry.status, "BAIXADA");
  assert.equal((await post(receitaRota, `/api/compras/fornecedores/${loja.id}/receita`, {}, params({ supplierId: loja.id }), "owner-b", orgB)).status, 404, "outra empresa não confere");
});

const listaCsv = [
  "LOJA TESTE — TABELA DE PREÇOS",
  "Produto;Unid.;Preço à vista",
  "Cimento CP II-E-32 50 kg;sc;\"38,90\"",
  "Vergalhão CA-50 10 mm barra 12 m;br;54,30",
  "Areia média lavada;m³;145,00",
  "Promoções da semana;;",
].join("\n");

test("lista de preços da loja: vira catálogo, preço de produto e sugestão de fornecedor", async () => {
  const loja = (await post(fornecedores, "/api/compras/fornecedores", { name: "Loja Teste", categories: "Hidráulica" })).body.supplier;
  const enviar = (csv, data = "2026-11-01", user = "owner", org = orgA) => {
    const form = new FormData(); form.set("validOn", data); form.set("arquivo", new File([csv], "tabela-loja.csv", { type: "text/csv" }));
    return json(listaRota.PUT(new Request(`https://platform.test/api/compras/fornecedores/${loja.id}/lista`, { method: "PUT", body: form, headers: { "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test`, cookie: `__Host-nexo-organization=${org}` } }), params({ supplierId: loja.id })));
  };
  const importado = await enviar(listaCsv);
  assert.equal(importado.status, 200, JSON.stringify(importado.body));
  assert.deepEqual([importado.body.report.itens, importado.body.report.ignoradas], [3, 1]);
  assert.deepEqual(importado.body.supplier.priceList, { validOn: "2026-11-01", items: 3, fileName: "tabela-loja.csv" });
  assert.equal((await enviar(listaCsv, "2999-01-01")).status, 400, "data no futuro");
  assert.equal((await enviar(listaCsv, "2026-11-01", "owner-b", orgB)).status, 404, "outra empresa não importa");

  const achado = await buscar("fornecedor", "vergalhão");
  assert.equal(achado.body.items.length, 1);
  assert.equal(achado.body.items[0].unitCostCents, 5_430);
  assert.equal(achado.body.items[0].label, "Lista de preços de Loja Teste · 01/11/2026");
  assert.equal((await buscar("fornecedor", "vergalhão", "owner-b", orgB)).body.items.length, 0);

  // Produto do catálogo padrão em falta: a loja aparece como possível fornecedor pelo
  // item parecido na lista, com o preço que ela mandou.
  const produto = (await post(produtos, "/api/compras/produtos", { reference: "PADRAO:MAT-044" })).body.product;
  await json(minimos.PUT(h.request("owner", "/api/compras/estoque/minimos", { method: "PUT", json: { productId: produto.id, location: "central", minimum: 30 } })));
  const atencao = (await json(estoque.GET(h.request("owner", "/api/compras/estoque")))).body.attention;
  const sugestao = atencao.find((a) => a.productId === produto.id).suggestions[0];
  assert.equal(sugestao.name, "Loja Teste");
  assert.match(sugestao.reason, /Lista de preços de 01\/11\/2026: Vergalhão CA-50 10 mm barra 12 m a R\$\s?54,30\/br/);

  // A nova lista substitui a anterior inteira.
  assert.equal((await enviar("Descrição;Unidade;Preço\nTubo PVC 25 mm;br;19,90", "2026-11-10")).body.supplier.priceList.items, 1);
  assert.equal((await buscar("fornecedor", "vergalhão")).body.items.length, 0);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) n FROM supplier_price_items").get().n, 1);
});
