import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const analysis = await vite.ssrLoadModule("/lib/finance-analysis.ts");
test.after(() => vite.close());

// Planilha real de escritório: setor, horas, receita, custo de colaborador e outros custos.
function sheet() {
  return {
    A1: "Setor", B1: "Horas", C1: "Receita", D1: "Custo colaborador", E1: "Outros custos",
    A2: "Projeto", B2: "100", C2: "30000", D2: "12000", E2: "3000",
    A3: "Obra", B3: "200", C3: "40000", D3: "30000", E3: "18000",
    A4: "Consultoria", B4: "50", C4: "20000", D4: "6000", E4: "1000",
  };
}
const roles = { A: "setor", B: "horas", C: "receita", D: "custo_colaborador", E: "custo" };
const run = (cells, overrides = {}) => analysis.analyzeSheet(cells, 5, 10, {
  headerRow: 0, roles, targetMarginPercent: 20, ...overrides,
});
const finding = (result, id) => result.findings.find((item) => item.id === id);
// Dinheiro é comparado exato. Percentual e valor por hora têm dízima, então a comparação
// usa tolerância — o motor já corta o ruído binário em 15 dígitos significativos.
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${message ?? "valor"}: esperado ~${expected}, veio ${actual}`);

test("uma planilha sem papéis marcados não inventa número nenhum", () => {
  const result = analysis.analyzeSheet(sheet(), 5, 10, { headerRow: 0, roles: {}, targetMarginPercent: 20 });
  assert.equal(result.ready, false);
  assert.equal(result.totals.revenue, 0);
  assert.equal(result.totals.margin, 0);
  assert.equal(result.sectors.length, 0);
  assert.ok(result.missing.length >= 2, "diz o que falta marcar em vez de adivinhar");
  assert.ok(result.findings.every((item) => item.severity === "faltando"));
});

test("soma receita, custo e margem exatamente como está na planilha", () => {
  const result = run(sheet());
  assert.equal(result.ready, true);
  assert.equal(result.rowsCounted, 3);
  assert.equal(result.totals.revenue, 90000);
  assert.equal(result.totals.collaboratorCost, 48000);
  assert.equal(result.totals.otherCost, 22000);
  assert.equal(result.totals.cost, 70000);
  assert.equal(result.totals.margin, 20000);
  close(result.totals.marginPercent, 200 / 9, "margem %");
  assert.equal(result.totals.hours, 350);
});

test("diz de quanto precisa ser o aumento de preço, pela conta e não por palpite", () => {
  // Custo 70.000 com meta de 30%: a receita precisa ser 70.000 / 0,70 = 100.000.
  const result = run(sheet(), { targetMarginPercent: 30 });
  assert.equal(result.overall.requiredRevenue, 100000);
  close(result.overall.priceIncreasePercent, 100 / 9, "aumento necessário %");
  assert.equal(result.overall.costCutNeeded, 7000, "ou cortar 7.000 de custo dá a mesma margem");
  // 90.000 * (1 - 0,30) = 63.000 de custo máximo; hoje são 70.000.
  assert.equal(finding(result, "geral:abaixo").severity, "abaixo");
  assert.match(finding(result, "geral:abaixo").action, /11,1%/);
});

test("não manda aumentar preço quando a margem já está na meta", () => {
  const result = run(sheet(), { targetMarginPercent: 20 });
  assert.equal(finding(result, "geral:saudavel").severity, "saudavel");
  assert.equal(finding(result, "geral:saudavel").action, null);
  assert.equal(finding(result, "geral:abaixo"), undefined);
});

test("aponta a margem por hora e o preço mínimo da hora", () => {
  const result = run(sheet(), { targetMarginPercent: 30 });
  // 90.000 / 350 h = 257,142857 por hora; 70.000 / 350 = 200 por hora.
  close(result.perHour.revenue, 90000 / 350, "receita por hora");
  assert.equal(result.perHour.cost, 200);
  close(result.perHour.margin, 90000 / 350 - 200, "margem por hora");
  close(result.perHour.required, 200 / 0.7, "preço mínimo da hora");
  close(result.perHour.increasePercent, 100 / 9, "aumento da hora %");
});

test("sem coluna de horas, a análise diz que não dá para calcular em vez de estimar", () => {
  const result = run(sheet(), { roles: { A: "setor", C: "receita", D: "custo_colaborador", E: "custo" } });
  assert.equal(result.perHour, null);
  assert.equal(result.totals.hours, 0);
  const missing = finding(result, "faltando:horas");
  assert.equal(missing.severity, "faltando");
  assert.match(missing.action, /Marque a coluna de horas/);
});

test("separa onde ganha e onde perde por setor", () => {
  const result = run(sheet(), { targetMarginPercent: 20 });
  const porNome = Object.fromEntries(result.sectors.map((sector) => [sector.name, sector]));

  assert.equal(porNome.Obra.revenue, 40000);
  assert.equal(porNome.Obra.margin, -8000);
  assert.equal(porNome.Obra.status, "perda");
  assert.equal(porNome.Consultoria.margin, 13000);
  assert.equal(porNome.Consultoria.marginPercent, 65);
  assert.equal(porNome.Consultoria.status, "saudavel");
  assert.equal(porNome.Projeto.margin, 15000);
  assert.equal(result.sectors[0].name, "Projeto", "a lista sai da maior para a menor sobra");

  const prejuizo = finding(result, "setor:Obra");
  assert.equal(prejuizo.severity, "perda");
  assert.match(prejuizo.title, /Obra dá prejuízo/);
  // Custo 48.000 com meta de 20% pede receita de 60.000: 50% acima dos 40.000 atuais.
  assert.equal(porNome.Obra.requiredRevenue, 60000);
  assert.equal(porNome.Obra.priceIncreasePercent, 50);
  assert.match(prejuizo.action, /50%/);
  assert.ok(result.findings.some((item) => item.id.startsWith("setor:melhor:")));
});

test("mede o peso do colaborador contra o teto de custo da meta", () => {
  const result = run(sheet(), { targetMarginPercent: 30 });
  const peso = finding(result, "colaborador:peso");
  // 48.000 / 90.000 = 53,3% da receita; todos os custos somam 77,8% contra um teto de 70%.
  assert.match(peso.title, /53,3%/);
  assert.equal(peso.severity, "abaixo");
  assert.match(peso.action, /70%/);
  close(result.totals.collaboratorSharePercent, 4800000 / 90000, "peso do colaborador %");
  close(result.totals.costSharePercent, 7000000 / 90000, "peso do custo %");
});

test("calcula receita por quantidade vezes preço quando não há coluna de receita", () => {
  const cells = {
    A1: "Serviço", B1: "Qtd", C1: "Preço", D1: "Custo",
    A2: "Projeto executivo", B2: "3", C2: "5000", D2: "9000",
    A3: "Laudo", B3: "10", C3: "800", D3: "2000",
  };
  const result = analysis.analyzeSheet(cells, 4, 6, {
    headerRow: 0, roles: { A: "setor", B: "quantidade", C: "preco_unitario", D: "custo" }, targetMarginPercent: 20,
  });
  assert.equal(result.totals.revenue, 23000, "3 x 5.000 mais 10 x 800");
  assert.equal(result.totals.cost, 11000);
  assert.equal(result.totals.margin, 12000);
});

test("lê o valor calculado das fórmulas, não o texto delas", () => {
  const cells = {
    A1: "Setor", B1: "Receita", C1: "Custo",
    A2: "Obra", B2: "=1000*12", C2: "=SOMA(5000;4000)",
  };
  const result = analysis.analyzeSheet(cells, 3, 5, {
    headerRow: 0, roles: { A: "setor", B: "receita", C: "custo" }, targetMarginPercent: 20,
  });
  assert.equal(result.totals.revenue, 12000);
  assert.equal(result.totals.cost, 9000);
  assert.equal(result.totals.margin, 3000);
});

test("dinheiro não carrega ruído binário na leitura", () => {
  const cells = { A1: "Setor", B1: "Receita", C1: "Custo", A2: "Obra", B2: "89,90", C2: "12,10", A3: "Obra", B3: "0,10", C3: "0,20" };
  const result = analysis.analyzeSheet(cells, 3, 5, {
    headerRow: 0, roles: { A: "setor", B: "receita", C: "custo" }, targetMarginPercent: 20,
  });
  assert.equal(result.totals.revenue, 90);
  assert.equal(result.totals.cost, 12.3);
  assert.equal(result.totals.margin, 77.7);
});

test("a sugestão de papéis lê o cabeçalho e não muda nada sozinha", () => {
  const cells = {
    A1: "Centro de custo", B1: "Horas trabalhadas", C1: "Faturamento", D1: "Salário da equipe",
    E1: "Despesas", F1: "Observação",
  };
  const suggested = analysis.suggestRoles(cells, 6, 0);
  assert.equal(suggested.A, "setor");
  assert.equal(suggested.B, "horas");
  assert.equal(suggested.C, "receita");
  assert.equal(suggested.D, "custo_colaborador");
  assert.equal(suggested.E, "custo");
  assert.equal(suggested.F, undefined, "o que não é reconhecido fica sem papel, não é chutado");

  // A sugestão sozinha não produz análise: sem confirmar, nada é calculado.
  const semConfirmar = analysis.analyzeSheet(cells, 6, 5, { headerRow: 0, roles: {}, targetMarginPercent: 20 });
  assert.equal(semConfirmar.ready, false);
});

test("linhas em branco e linhas sem número não entram na conta", () => {
  const cells = {
    A1: "Setor", B1: "Receita", C1: "Custo",
    A2: "Obra", B2: "1000", C2: "400",
    A3: "", B3: "", C3: "",
    A4: "Rodapé sem valores", B4: "", C4: "",
    A5: "Obra", B5: "500", C5: "100",
  };
  const result = analysis.analyzeSheet(cells, 3, 8, {
    headerRow: 0, roles: { A: "setor", B: "receita", C: "custo" }, targetMarginPercent: 20,
  });
  assert.equal(result.rowsCounted, 2);
  assert.equal(result.totals.revenue, 1500);
  assert.equal(result.sectors.length, 1);
});
