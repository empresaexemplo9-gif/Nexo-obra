import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const templates = await vite.ssrLoadModule("/lib/worksheet-templates.ts");
const sheet = await vite.ssrLoadModule("/lib/spreadsheet.ts");
const analysis = await vite.ssrLoadModule("/lib/finance-analysis.ts");
test.after(() => vite.close());

const build = (id) => templates.buildTemplateContent(templates.templateById(id));

test("todo modelo tem objetivo, cabeçalho e nenhum dado inventado", () => {
  assert.ok(templates.worksheetTemplates.length >= 8);
  for (const template of templates.worksheetTemplates) {
    assert.ok(template.purpose.length > 30, `${template.id} precisa dizer para que serve`);
    assert.ok(template.headers.length >= 5, `${template.id} precisa de cabeçalho`);
    assert.ok(["obra", "financeiro", "comercial"].includes(template.category));

    const content = build(template.id);
    const computed = sheet.evaluateSheet(content.cells);
    // Nenhuma célula pode nascer com valor numérico digitado: só cabeçalho e fórmula.
    for (const [key, raw] of Object.entries(content.cells)) {
      if (raw.startsWith("=")) continue;
      assert.equal(sheet.parseNumber(raw), null, `${template.id}: ${key} traz um número de exemplo`);
    }
    // E nenhuma fórmula pode nascer quebrada.
    for (const [key, cell] of Object.entries(computed)) {
      assert.equal(cell.error, null, `${template.id}: ${key} deu ${cell.error}`);
    }
  }
});

test("modelo em branco não produz número: as linhas vazias ficam vazias", () => {
  const content = build("orcamento-obra");
  const computed = sheet.evaluateSheet(content.cells);
  assert.equal(computed.F2.display, "", "sem quantidade digitada, o total fica em branco e não vira zero");
  assert.equal(computed.I2.display, "");
  const totalRow = Object.keys(content.cells).find((key) => content.cells[key] === "Total do orçamento");
  assert.ok(totalRow);
  assert.equal(computed[totalRow.replace("A", "F")].value, 0, "o total soma zero enquanto não há lançamento");
});

test("o orçamento calcula custo, BDI e margem ao receber os dados reais", () => {
  const content = build("orcamento-obra");
  const cells = { ...content.cells, A2: "Alvenaria", B2: "Bloco cerâmico", C2: "m²", D2: "120", E2: "89,90", G2: "25" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.F2.value, 10788, "120 x 89,90");
  assert.equal(computed.H2.value, 13485, "com 25% de BDI");
  assert.equal(computed.I2.value, 2697);
});

test("a apropriação de horas alimenta a margem por hora sem marcar nada a mais", () => {
  const content = build("apropriacao-horas");
  const cells = {
    ...content.cells,
    A2: "Casa Alfa", B2: "Ana", D2: "40", E2: "60", G2: "4000",
    A3: "Casa Alfa", B3: "Bruno", D3: "20", E3: "45", G3: "1500",
  };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.F2.value, 2400);
  assert.equal(computed.F3.value, 900);

  const reading = analysis.analyzeSheet(cells, content.columns, content.rows, content.analysis);
  assert.equal(reading.ready, true, "os papéis já vêm marcados no modelo");
  assert.equal(reading.totals.revenue, 5500);
  assert.equal(reading.totals.collaboratorCost, 3300);
  assert.equal(reading.totals.hours, 60);
  assert.ok(reading.perHour, "com horas marcadas, a margem por hora sai direto");
  assert.ok(Math.abs(reading.perHour.revenue - 5500 / 60) < 1e-9, "a hora rende receita dividida pelas horas");
  assert.ok(Math.abs(reading.perHour.cost - 3300 / 60) < 1e-9, "e custa o custo de equipe dividido pelas horas");
});

test("o resultado por centro aponta o projeto que dá prejuízo", () => {
  const content = build("resultado-mensal");
  const cells = {
    ...content.cells,
    A2: "Reforma comercial", B2: "50000", C2: "20000", D2: "18000", E2: "5000",
    A3: "Projeto residencial", B3: "30000", C3: "26000", D3: "9000", E3: "3000",
  };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.F2.value, 7000);
  assert.equal(computed.F3.value, -8000);

  const reading = analysis.analyzeSheet(cells, content.columns, content.rows, content.analysis);
  const prejuizo = reading.sectors.find((sector) => sector.name === "Projeto residencial");
  assert.equal(prejuizo.status, "perda");
  assert.equal(prejuizo.margin, -8000);
  assert.ok(reading.findings.some((item) => item.id === "setor:Projeto residencial" && item.severity === "perda"));
});

test("o fluxo de caixa acumula o saldo linha a linha", () => {
  const content = build("fluxo-de-caixa");
  const cells = { ...content.cells, A2: "01/09", D2: "10000", A3: "02/09", E3: "3500", A4: "03/09", D4: "2000", E4: "500" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.F2.value, 10000);
  assert.equal(computed.G2.value, 10000, "a primeira linha começa o acumulado");
  assert.equal(computed.G3.value, 6500);
  assert.equal(computed.G4.value, 8000);
});

test("o funil pondera a proposta pela probabilidade e mostra a margem proposta", () => {
  const content = build("funil-comercial");
  const cells = { ...content.cells, A2: "Cliente X", B2: "Projeto executivo", C2: "Proposta", D2: "40000", E2: "60", G2: "22000" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.F2.value, 24000, "40.000 x 60%");
  assert.equal(computed.H2.value, 18000);
});

test("os honorários dividem o contrato pelo percentual de cada etapa", () => {
  const content = build("honorarios-etapas");
  const cells = { ...content.cells, J1: "80000", A2: "Estudo preliminar", B2: "15", A3: "Executivo", B3: "45", F3: "20000" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.C2.value, 12000);
  assert.equal(computed.C3.value, 36000);
  assert.equal(computed.G3.value, 16000);
});

test("o levantamento calcula área, volume e perda", () => {
  const content = build("levantamento-quantitativos");
  const cells = { ...content.cells, A2: "Sala", B2: "Piso", C2: "5", D2: "4", E2: "2,7", H2: "10" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.F2.value, 20);
  assert.equal(computed.G2.value, 54);
  assert.equal(computed.I2.value, 22, "20 m² com 10% de perda");
});

test("a medição só fatura o percentual que falta medir", () => {
  const content = build("medicao-obra");
  const cells = { ...content.cells, A2: "Fundação", B2: "120000", C2: "70", D2: "40", G2: "25000" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.E2.value, 30);
  assert.equal(computed.F2.value, 36000);
  assert.equal(computed.H2.value, 11000);
});

test("compras compara a cotação escolhida com a melhor cotação", () => {
  const content = build("compras-cotacoes");
  const cells = { ...content.cells, A2: "Cimento", B2: "Fornecedor A", C2: "100", D2: "42", F2: "38" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.E2.value, 4200);
  assert.equal(computed.G2.value, 400, "100 x (42 - 38)");
});

test("o cronograma aponta o desvio entre previsto e realizado", () => {
  const content = build("cronograma-fisico-financeiro");
  const cells = { ...content.cells, A2: "Estrutura", D2: "80000", F2: "92000" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.H2.value, 12000);
  assert.equal(computed.I2.value, 15, "15% acima do previsto");
});
