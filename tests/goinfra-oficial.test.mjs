import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness } from "./helpers/api-harness.mjs";
import { gerarXls } from "./helpers/xls-fixture.mjs";

// GOINFRA oficial: leitura do XLS publicado pela agência, conferência da data-base e do
// regime no cabeçalho e busca automática no site. As páginas e planilhas abaixo seguem o
// formato real observado em goias.gov.br/goinfra (nov/2026), com poucos itens de teste;
// nada daqui chega ao runtime.

const h = await createHarness();
const { abrirPlanilhaXls, ehXls } = await h.load("/lib/integrations/planilha-xls.ts");
const { interpretarGoinfra } = await h.load("/lib/integrations/goinfra-planilha.ts");
const importacao = await h.load("/lib/server/goinfra-import.ts");
const fonte = await h.load("/lib/server/goinfra-fonte.ts");
const catalogo = await h.load("/app/api/compras/catalogo/route.ts");
const cron = await h.load("/app/api/cron/banco/route.ts");
const { migrations } = await h.load("/lib/server/migrations.ts");

beforeEach(() => h.reset());
after(() => h.close());

/** Planilha no formato do "Custo Referencial de Materiais" da GOINFRA. */
function tabelaDeMateriais({ regime = "SEM DESONERAÇÃO", numero = "334", mes = "FEVEREIRO/2026", dataBase = "01/02/2026", extra = [] } = {}) {
  const itens = [
    [{ rk: 110 }, "ÁCIDO MURIÁTICO (D=1,2 KG/L)", "l", 11.32],
    [{ rk: 2439 }, "AÇO CA-50 10,0 MM (3/8\")", "Kg", 6.87],
    [{ rk: 1215 }, "CIMENTO PORTLAND CPII-32", "Kg", { centesimos: 66 }],
    ["H712", "VASO SANITÁRIO PARA PcD COM CAIXA ACOPLADA", "un", { formula: 1140.36 }],
    ...Array.from({ length: 8 }, (_, i) => [{ rk: 9000 + i }, `MATERIAL DE TESTE ${i + 1}`, "un", 10 + i]),
    ...extra,
  ];
  return gerarXls([
    ["GOINFRA - Agência Goiana de Infraestrutura e Transportes", null, null, null, null, "05/05/2026 - 08:22"],
    [],
    ["Custo Referencial de Materiais (sem Bonificação)"],
    [],
    ["Tabela:", `${numero} - TABELA DE CUSTOS DE OBRAS CIVIS - T${numero} - ${mes} - ${regime}`, null, null, null, `Data base:  ${dataBase}`],
    [], [], [],
    ["01 - MATERIAL BÁSICO"],
    ["Código Auxiliar", "Descrição do Material", "Unidade", "Custo Unitário"],
    ...itens,
    ["SCO - Sistema de Custos e Orçamentos"],
  ], { cortar: "VASO SANITÁRIO PARA PcD COM CAIXA ACOPLADA" });
}

test("lê o XLS da GOINFRA: textos partidos entre registros, RK, MULRK, fórmula e cabeçalho", () => {
  const arquivo = tabelaDeMateriais();
  assert.equal(ehXls(arquivo), true);
  const planilha = abrirPlanilhaXls(arquivo);
  assert.deepEqual(planilha.abas, ["Relatório"]);
  assert.equal(planilha.linhas("Relatório")[13][1], "VASO SANITÁRIO PARA PcD COM CAIXA ACOPLADA", "texto cortado no CONTINUE volta inteiro");

  const lido = interpretarGoinfra(arquivo, "materiais.xls");
  assert.equal(lido.itens.length, 12);
  assert.equal(lido.ignoradas, 1, "o rodapé; o título de grupo antes do cabeçalho nem entra na leitura");
  assert.deepEqual(lido.cabecalho, { dataBase: "2026-02", regime: "NaoDesonerado", numero: "334", titulo: "334 - TABELA DE CUSTOS DE OBRAS CIVIS - T334 - FEVEREIRO/2026 - SEM DESONERAÇÃO" });
  assert.deepEqual(lido.itens.slice(0, 4).map((i) => [i.codigo, i.unidade, i.custoUnitarioCentavos]), [["110", "l", 1132], ["2439", "Kg", 687], ["1215", "Kg", 66], ["H712", "un", 114036]]);
  assert.throws(() => abrirPlanilhaXls(Buffer.from("não é planilha")), /não é um XLS/);
  const numeros = abrirPlanilhaXls(gerarXls([[{ rk: 1 }, { rk: 22 }, { rk: -3 }, { label: "Mão de obra" }, 0.1]]));
  assert.deepEqual(numeros.linhas("Relatório")[0], ["1", "22", "-3", "Mão de obra", "0.1"], "MULRK, inteiro negativo, LABEL e NUMBER");
});

test("importação confere data-base e regime contra o cabeçalho da planilha", async () => {
  const arquivo = { nome: "materiais.xls", bytes: tabelaDeMateriais() };
  await assert.rejects(importacao.importarGoinfra(arquivo, { tabela: "materiais", regime: "Desonerado" }, "teste"), /sem desoneração, diferente do regime informado/);
  await assert.rejects(importacao.importarGoinfra(arquivo, { tabela: "materiais", referencia: "2026-04" }, "teste"), /data-base 02\/2026, não 04\/2026/);
  const certo = await importacao.importarGoinfra(arquivo, { tabela: "materiais" }, "teste");
  assert.deepEqual(certo.alvo, { referencia: "2026-02", tabela: "materiais", regime: "NaoDesonerado" }, "data-base e regime lidos da planilha");
});

const paginaDeMateriais = (arquivos) => `<html><body><main><h1>Custo Referencial de Materiais</h1><table class="planilhaview">${arquivos.map((a) =>
  `<tr><td>${a}</td><td><a href="https://goias.gov.br/goinfra/wp-content/uploads/sites/77/tabela-de-composicao/120/arquivos/${a}. Clique aqui para download em PDF Clique aqui para download em XLS.xls">XLS</a></td></tr>`).join("")}
  <tr><td><a href="https://outro-site.example/arquivos/Tabela de Insumos Materiais - ABRIL-2026 - SEM DESONERAÇÃO.xls">fora do portal</a></td></tr></table></main></body></html>`;

function siteDaGoinfra(paginas, arquivos) {
  const pedidos = [];
  const buscar = async (url) => {
    const endereco = decodeURIComponent(String(url));
    pedidos.push(endereco);
    for (const [trecho, html] of Object.entries(paginas)) if (endereco.endsWith(trecho)) return new Response(html, { headers: { "content-type": "text/html" } });
    for (const [trecho, bytes] of Object.entries(arquivos)) if (endereco.includes(trecho)) return new Response(bytes, { headers: { "content-type": "application/vnd.ms-excel" } });
    return new Response("não encontrado", { status: 404 });
  };
  return { buscar, pedidos };
}

test("acha na página da GOINFRA o arquivo mais recente de cada regime e ignora outro site", () => {
  const html = paginaDeMateriais([
    "Tabela de Insumos Materiais - FEVEREIRO-2026 - SEM DESONERAÇÃO - Publicada em 05-05-2026",
    "Tabela de Insumos Materiais - FEVEREIRO-2026 - COM DESONERAÇÃO - Publicada em 05-05-2026",
    "Tabela de Insumos Materiais - DEZEMBRO-2025 - SEM DESONERAÇÃO - Publicada em 05-03-2026",
  ]);
  const todos = fonte.arquivosDaPagina(html);
  assert.equal(todos.length, 3, "o link de outro site fica de fora");
  assert.deepEqual(fonte.maisRecentes(todos).map((a) => [a.regime, a.referencia]).sort(), [["Desonerado", "2026-02"], ["NaoDesonerado", "2026-02"]]);
});

test("busca automática importa a tabela nova do site, não repete e registra falhas", async () => {
  const sem = "Tabela de Insumos Materiais - FEVEREIRO-2026 - SEM DESONERAÇÃO - Publicada em 05-05-2026";
  const com = "Tabela de Insumos Materiais - FEVEREIRO-2026 - COM DESONERAÇÃO - Publicada em 05-05-2026";
  const { buscar, pedidos } = siteDaGoinfra({
    "/goinfra/tabela-de-insumos/": `<a href="https://goias.gov.br/goinfra/custo-referencial-de-materiais120/">Materiais</a>`,
    "/goinfra/custo-referencial-de-materiais120/": paginaDeMateriais([sem, com]),
  }, {
    [sem]: tabelaDeMateriais(),
    [com]: tabelaDeMateriais({ regime: "COM DESONERAÇÃO", numero: "333", extra: [[{ rk: 777 }, "CIMENTO BRANCO ESTRUTURAL", "Kg", 3.5]] }),
  });
  const primeira = await fonte.sincronizarGoinfra("teste", { forcar: true, buscar });
  assert.deepEqual(primeira.imported, ["Materiais (insumos) não desonerada 02/2026 (12 itens)", "Materiais (insumos) desonerada 02/2026 (13 itens)"]);
  assert.equal(primeira.failures.length, 2, "mão de obra e serviços sem página no site de teste ficam registrados como falha");
  assert.ok(!pedidos.some((p) => p.includes("outro-site.example")), "nunca baixa fora do portal");

  // O catálogo de Compras abre a tabela importada, com o rótulo da referência.
  const aberto = await (await catalogo.GET(h.request("owner", "/api/compras/catalogo?fonte=goinfra&q=cimento"))).json();
  assert.deepEqual(aberto.items.map((i) => [i.code, i.unitCostCents, i.label]), [
    ["777", 350, "GOINFRA Materiais (insumos) · Desonerada · 02/2026"],
    ["1215", 66, "GOINFRA Materiais (insumos) · Desonerada · 02/2026"],
    ["1215", 66, "GOINFRA Materiais (insumos) · Não desonerada · 02/2026"],
  ]);

  const baixados = pedidos.filter((p) => p.endsWith(".xls")).length;
  const segunda = await fonte.sincronizarGoinfra("teste", { forcar: true, buscar });
  assert.deepEqual(segunda.imported, []);
  assert.equal(pedidos.filter((p) => p.endsWith(".xls")).length, baixados, "referência já ativa não é baixada de novo");
  const registro = await fonte.situacaoDaBusca();
  assert.equal(registro.result, "Nenhuma tabela nova importada.");
  assert.match(registro.error, /Serviços de obras civis: a página .* respondeu HTTP 404/);

  // Sem forçar, a conferência roda no máximo uma vez a cada 20 horas.
  assert.deepEqual(await fonte.sincronizarGoinfra("teste", { buscar }), { ran: false, reason: "conferido há menos de 20 horas" });
});

test("a atualização de hora em hora confere a GOINFRA depois do banco em dia", async () => {
  h.runtime.CRON_SECRET = "segredo";
  // Banco como em produção: todas as migrações aplicadas e registradas.
  h.db.sqlite.exec("CREATE TABLE IF NOT EXISTS _platform_migrations (id text PRIMARY KEY NOT NULL, statements integer NOT NULL, skipped integer NOT NULL DEFAULT 0, applied_at integer NOT NULL)");
  for (const m of migrations) h.db.sqlite.prepare("INSERT INTO _platform_migrations VALUES (?, 1, 0, 1)").run(m.id);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("fora do ar", { status: 503 });
  try {
    const resposta = await cron.GET(new Request("https://platform.test/api/cron/banco", { headers: { authorization: "Bearer segredo" } }));
    assert.equal(resposta.status, 200, "falha na GOINFRA não derruba a atualização do banco");
    const corpo = await resposta.json();
    assert.equal(corpo.goinfra.ran, true);
    assert.equal(corpo.goinfra.failures.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});
