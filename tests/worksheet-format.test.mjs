import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Formatação de texto por célula e mesclagem na planilha.

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
const format = await vite.ssrLoadModule("/lib/worksheet-format.ts");
const { contentSchema } = await vite.ssrLoadModule("/lib/worksheets.ts");
const sheet = await vite.ssrLoadModule("/lib/spreadsheet.ts");
const tools = await vite.ssrLoadModule("/lib/worksheet-tools.ts");
after(() => vite.close());

test("marcar liga em todas; se todas já têm, desliga — e estilo vazio some", () => {
  const ligado = format.toggleFlag({}, ["A1", "B1"], "italic");
  assert.deepEqual(ligado, { A1: { italic: true }, B1: { italic: true } });
  const misto = format.toggleFlag({ A1: { italic: true } }, ["A1", "B1"], "italic");
  assert.deepEqual(misto, { A1: { italic: true }, B1: { italic: true } }, "com uma sem, liga em todas");
  assert.deepEqual(format.toggleFlag(ligado, ["A1", "B1"], "italic"), {}, "desligar não deixa objeto vazio para trás");
  const alinhado = format.setStyle({ A1: { italic: true } }, ["A1"], "align", "center");
  assert.deepEqual(alinhado, { A1: { italic: true, align: "center" } });
  assert.deepEqual(format.setStyle(alinhado, ["A1"], "align", undefined), { A1: { italic: true } });
  assert.deepEqual(format.clearStyles(alinhado, ["A1"]), {});
});

test("o servidor só aceita a paleta e as marcas conhecidas", () => {
  assert.equal(contentSchema.safeParse({ styles: { A1: { italic: true, align: "center", color: "red", fill: "yellow", wrap: true } } }).success, true);
  for (const style of [{ color: "#ff0000" }, { fill: "url(x)" }, { align: "justify" }, { italic: false }, { fontSize: 40 }]) {
    assert.equal(contentSchema.safeParse({ styles: { A1: style } }).success, false, JSON.stringify(style));
  }
  assert.equal(contentSchema.safeParse({ styles: { ZZ9999: { italic: true } } }).success, false, "célula fora da grade");
});

test("mesclagens: pelo menos duas células, dentro da grade e sem sobrepor", () => {
  assert.equal(contentSchema.safeParse({ merges: ["A1:C1", "A2:A4"] }).success, true);
  for (const merges of [["A1:A1"], ["A1:C1", "B1:D1"], ["AZ1:BA1"], ["A1:A501"], ["A1"]]) {
    assert.equal(contentSchema.safeParse({ merges }).success, false, JSON.stringify(merges));
  }
});

test("mesclar absorve as de dentro, recusa as cortadas e avisa o que some", () => {
  assert.deepEqual(format.mergeRange(["B1:C1"], "A1:D2"), ["A1:D2"]);
  assert.deepEqual(format.mergeRange([], "C3:A1"), ["A1:C3"], "o intervalo é normalizado");
  assert.throws(() => format.mergeRange(["C1:E1"], "A1:D1"), /corta a mesclagem C1:E1/);
  assert.throws(() => format.mergeRange([], "A1"), /duas ou mais/);
  assert.deepEqual(format.cellsHiddenByMerge({ A1: "Título", B1: "x", C1: "", D1: "fora" }, "A1:C1"), ["B1"]);
  assert.deepEqual(format.unmergeAt(["A1:C1", "A3:B3"], "B1"), ["A3:B3"]);
  assert.equal(format.mergeAt(["A1:C2"], "C2").anchor, "A1");
  assert.equal(format.mergeAt(["A1:C2"], "D1"), null);
});

test("inserir e remover linha estica, encolhe e desloca mesclagens e estilos", () => {
  assert.deepEqual(format.shiftMerges(["A2:A4"], "row", 2, 1), ["A2:A5"], "inserir dentro estica");
  assert.deepEqual(format.shiftMerges(["A2:A4"], "row", 0, 1), ["A3:A5"], "inserir acima desloca");
  assert.deepEqual(format.shiftMerges(["A2:A4"], "row", 5, 1), ["A2:A4"], "inserir abaixo não mexe");
  assert.deepEqual(format.shiftMerges(["A2:A3"], "row", 1, -1), [], "encolher até uma célula desfaz");
  assert.deepEqual(format.shiftMerges(["A1:C1"], "column", 1, -1), ["A1:B1"]);
  assert.deepEqual(format.shiftKeyed({ A5: { italic: true }, B2: { fill: "yellow" } }, "row", 2, 1), { A6: { italic: true }, B2: { fill: "yellow" } });
  assert.deepEqual(format.shiftKeyed({ A5: { italic: true }, A2: { fill: "yellow" } }, "row", 1, -1), { A4: { italic: true } }, "a linha removida leva o estilo junto");
});

test("ordenar devolve para onde foi cada linha, e o estilo acompanha", () => {
  const cells = { A1: "Item", A2: "b", A3: "a" };
  const ordenado = sheet.sortRows(cells, { columns: 1, rows: 5, headerRow: 0, column: 0, direction: "asc" });
  assert.deepEqual(ordenado.destination, { 2: 1, 1: 2, 3: 3, 4: 4 });
  assert.deepEqual(format.remapRows({ A2: { italic: true } }, ordenado.destination), { A3: { italic: true } });
  assert.equal(format.mergeSpansRows(["A2:A3"], 1, 5), true);
  assert.equal(format.mergeSpansRows(["A2:C2"], 1, 5), false, "mesclagem numa linha só não impede");
});

test("CSS da célula traduz o estilo sem aceitar nada de fora da paleta", () => {
  assert.deepEqual(format.styleCss({ italic: true, underline: true, strike: true, align: "right", color: "red", wrap: true }), {
    fontStyle: "italic", textDecorationLine: "underline line-through", textAlign: "right", color: "#b91c1c", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
  });
  assert.deepEqual(format.styleCss(undefined), {});
});

test("a impressão leva a mesclagem inteira e os estilos", () => {
  const computed = sheet.evaluateSheet({ A1: "Orçamento", A2: "x" });
  const { letras, linhas } = tools.tabelaParaImpressao(computed, {}, [], 10, 10, { A1: { align: "center", fill: "yellow" } }, ["A1:D1"]);
  assert.deepEqual(letras, ["A", "B", "C", "D"], "o título mesclado alcança a coluna D");
  assert.equal(linhas[0][0].colSpan, 4);
  assert.equal(linhas[0][1].coberta, true);
  assert.deepEqual(linhas[0][0].css, { textAlign: "center", backgroundColor: "#fef9c3" });
});
