import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import ExcelJS from "exceljs";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
const advanced = await vite.ssrLoadModule("/lib/worksheet-advanced.ts");
const { evaluateSheet } = await vite.ssrLoadModule("/lib/spreadsheet.ts");
const { contentSchema } = await vite.ssrLoadModule("/lib/worksheets.ts");
const { importXlsx, exportXlsx, readXlsxBody } = await vite.ssrLoadModule("/lib/server/worksheet-xlsx.ts");
test.after(() => vite.close());
const settings = (input) => advanced.advancedSchema.parse(input);
const view = (aggregation = "sum") => ({ name: "Custos", range: "A1:B6", groupColumn: 0, valueColumn: 1, aggregation, chart: "bar" });
const cells = { A1: "Setor", B1: "Valor", A2: "Obra", B2: "1,25", A3: "Obra", B3: "=B2*2", A4: "Escritório", B4: "-10", A5: "Obra", B5: "texto" };

test("intervalos limitados, ordenados e sem referências fora da grade", () => {
  for (const range of ["A0", "BA1", "A501", "B2:A1", "A1:A5000", "A1:__proto__", "A1junk"]) assert.throws(() => advanced.rangeCells(range));
  assert.equal(advanced.rangeCells("AZ500").keys.length, 1);
  assert.equal(advanced.rangeCells("A1:B2").keys.length, 4);
  assert.equal(advanced.summaryViewSchema.safeParse({ ...view(), valueColumn: 2 }).success, false);
  assert.equal(advanced.summaryViewSchema.safeParse({ ...view(), range: "A1:B1" }).success, false);
});

test("validação usa resultados de fórmulas, limites inclusivos, datas reais e opções exatas", () => {
  const rules = settings({ validations: [
    { range: "A1:A4", kind: "number", min: 0, max: 10, allowBlank: false },
    { range: "B1:B3", kind: "date" }, { range: "C1:C3", kind: "list", options: ["Sim", "Não"] },
    { range: "D1", kind: "required" },
  ] });
  const issues = advanced.validationIssues(evaluateSheet({ A1: "0", A2: "=5*2", A3: "11", B1: "2024-02-29", B2: "2025-02-29", C1: "Sim", C2: "sim" }), rules);
  assert.deepEqual([...issues.keys()], ["A3", "A4", "B2", "C2", "D1"]);
  assert.equal(advanced.advancedSchema.safeParse({ validations: [{ range: "A1", kind: "list", options: [] }] }).success, false);
  assert.equal(advanced.advancedSchema.safeParse({ validations: [{ range: "A1", kind: "number", min: 2, max: 1 }] }).success, false);
});

test("cores condicionais reagem a fórmulas e respeitam a última regra", () => {
  const rules = settings({ conditions: [{ range: "A1:A3", kind: "greater", value: "2,5", color: "green" }, { range: "A1", kind: "less", value: "9", color: "red" }] });
  assert.deepEqual(advanced.conditionalColors(evaluateSheet({ A1: "=2*3", A2: "7", A3: "=1/0" }), rules), { A1: "#fee2e2", A2: "#dcfce7" });
  assert.equal(advanced.conditionalRuleSchema.safeParse({ range: "A1", kind: "greater", value: "nada", color: "red" }).success, false);
});

test("tabela dinâmica agrega dados reais, informa ignorados, não oculta erros", () => {
  const computed = evaluateSheet(cells);
  assert.deepEqual(advanced.summarize(computed, view()), { rows: [{ label: "Obra", value: 3.75 }, { label: "Escritório", value: -10 }], ignored: 1 });
  for (const [aggregation, expected] of [["average", 1.875], ["min", 1.25], ["max", 2.5], ["count", 3]]) assert.equal(advanced.summarize(computed, view(aggregation)).rows[0].value, expected);
  assert.throws(() => advanced.summarize(evaluateSheet({ ...cells, B2: "=1/0" }), view()), /linha 2/);
  assert.deepEqual(advanced.summarize({}, view()).rows, []);
  assert.equal(advanced.summarize(evaluateSheet({ A2: "__proto__", B2: "1" }), view()).rows[0].label, "__proto__");
});

test("inserção e exclusão deslocam regras, removendo somente referências excluídas", () => {
  const rules = settings({ validations: [{ range: "B2:B5", kind: "number" }], conditions: [{ range: "A1", kind: "blank", color: "red" }], views: [view()] });
  const moved = advanced.moveAdvanced(rules, "column", 1, 1);
  assert.equal(moved.validations[0].range, "C2:C5"); assert.equal(moved.views[0].valueColumn, 2); assert.equal(moved.views[0].range, "A1:C6");
  const deleted = advanced.moveAdvanced(rules, "column", 1, -1);
  assert.equal(deleted.validations.length, 0); assert.equal(deleted.views.length, 0); assert.equal(deleted.conditions.length, 1);
  assert.throws(() => advanced.moveAdvanced(settings({ validations: [{ range: "AZ1", kind: "number" }] }), "column", 0, 1), /limite/);
});

test("XLSX exporta números, texto literal, fórmulas de referência e formatos sem execução", async () => {
  const content = contentSchema.parse({ cells: { A1: "Descrição", A2: "'=literal", B1: "Valor", B2: "=12,5*2" }, formats: { B: "moeda" }, bold: ["A1"], widths: { A: 210 }, advanced: { conditions: [{ range: "B2", kind: "greater", value: "20", color: "green" }] } });
  const bytes = await exportXlsx("Custos/Obra", content, 2);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  assert.equal(workbook.worksheets[0].getCell("B2").value, 25);
  assert.equal(workbook.worksheets[0].getCell("A2").value, "=literal");
  assert.equal(workbook.worksheets[0].getCell("A1").font.bold, true);
  assert.equal(workbook.worksheets[0].getCell("B2").fill.fgColor.argb, "FFDCFCE7");
  assert.match(workbook.worksheets[0].getCell("B2").numFmt, /R\$/);
  assert.equal(workbook.worksheets[1].getCell("B2").value, "=12,5*2");
  const imported = await importXlsx(Buffer.from(bytes));
  assert.equal(imported[0].cells.A2, "'=literal");
  assert.equal(evaluateSheet(imported[0].cells).B2.value, 25);
  await assert.rejects(exportXlsx("Erro", contentSchema.parse({ cells: { A1: "=1/0" } }), 1), /Corrija/);
});

test("XLSX importa datas, decimais e resultados salvos; não inventa resultado de fórmula", async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Dados");
  sheet.getCell("A1").value = 1.234; sheet.getCell("B1").value = new Date("2024-02-29T00:00:00Z");
  sheet.getCell("C1").value = { formula: "A1*2", result: 2.468 };
  sheet.getCell("D1").value = "00123"; sheet.getCell("E1").value = 1e-12; sheet.getCell("F1").value = 0.123456789012345; sheet.getCell("G1").value = "TRUE";
  let imported = await importXlsx(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(evaluateSheet(imported[0].cells).A1.value, 1.234); assert.equal(imported[0].cells.B1, "2024-02-29");
  assert.equal(evaluateSheet(imported[0].cells).C1.value, 2.468); assert.match(imported[0].warnings.join(" "), /1 fórmula/);
  assert.equal(evaluateSheet(imported[0].cells).D1.value, "00123"); assert.equal(evaluateSheet(imported[0].cells).E1.value, 1e-12);
  assert.equal(evaluateSheet(imported[0].cells).F1.value, 0.123456789012345); assert.equal(evaluateSheet(imported[0].cells).G1.value, "TRUE");
  sheet.getCell("C1").value = { formula: "A1*2" };
  await assert.rejects(importXlsx(Buffer.from(await workbook.xlsx.writeBuffer())), /sem resultado salvo/);
});

test("XLSX trata nomes de abas reservados, truncados e aspas sem conflito", async () => {
  const content = contentSchema.parse({ cells: { A1: "=1+1" } });
  for (const name of ["fórmulas de referência", "'".repeat(10), "a".repeat(30) + "'fim", "Obra\u0000Sul"]) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await exportXlsx(name, content, 1));
    assert.equal(workbook.worksheets.length, 2); assert.equal(workbook.worksheets[0].getCell("A1").value, 2);
  }
});

test("XLSX recusa truncamento, dimensões, payload excessivo e limites reais de descompressão", async () => {
  await assert.rejects(importXlsx(Buffer.from("invalid")), /ZIP/);
  await assert.rejects(importXlsx(Buffer.alloc(4 * 1024 * 1024 + 1)), /4 MB/);
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Grande"); sheet.getCell("BA1").value = 1;
  await assert.rejects(importXlsx(Buffer.from(await workbook.xlsx.writeBuffer())), /52 colunas/);
  const request = new Request("https://local.test", { method: "POST", body: new Uint8Array(4 * 1024 * 1024 + 1) });
  await assert.rejects(readXlsxBody(request), /4 MB/);
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip(); zip.file("xl/workbook.xml", "x".repeat(8 * 1024 * 1024 + 1));
  const compressed = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await assert.rejects(importXlsx(compressed), /grande/);
  const unsafe = new JSZip(); unsafe.file("xl/externalLinks/externalLink1.xml", "url");
  await assert.rejects(importXlsx(await unsafe.generateAsync({ type: "nodebuffer" })), /vínculos externos/);
});
