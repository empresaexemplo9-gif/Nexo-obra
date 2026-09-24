import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Copiar, recortar e colar dentro da planilha, com colar especial.

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
const clip = await vite.ssrLoadModule("/lib/worksheet-clipboard.ts");
const sheet = await vite.ssrLoadModule("/lib/spreadsheet.ts");
const tools = await vite.ssrLoadModule("/lib/worksheet-tools.ts");
const format = await vite.ssrLoadModule("/lib/worksheet-format.ts");
const { contentSchema } = await vite.ssrLoadModule("/lib/worksheets.ts");
after(() => vite.close());

const conteudo = {
  cells: { A1: "10", B1: "=A1*2", A2: "Areia", B2: "=$A$1+A1" },
  styles: { A1: { italic: true } }, bold: ["B1"], notes: { A2: "cotação de 12/09" }, merges: [],
};
const recorte = () => clip.copiarIntervalo(conteudo, sheet.evaluateSheet(conteudo.cells), { top: 0, left: 0, bottom: 1, right: 1 });

test("fórmula copiada anda como no Excel; a travada com $ fica", () => {
  assert.equal(sheet.offsetFormula("=A1+$B$1+C$2+$D3", 2, 1), "=B3+$B$1+D$2+$D5");
  assert.equal(sheet.offsetFormula("=A1", -1, 0), "=#REF!", "sair da grade vira #REF!");
  assert.equal(sheet.offsetFormula("texto", 3, 3), "texto");
  const colado = clip.colarRecorte(conteudo, recorte(), { row: 4, column: 2 }, "tudo");
  assert.equal(colado.cells.D5, "=C5*2");
  assert.equal(colado.cells.D6, "=$A$1+C5");
  assert.deepEqual(colado.styles.C5, { italic: true });
  assert.ok(colado.bold.includes("D5"));
  assert.equal(colado.notes.C6, "cotação de 12/09", "a nota vai junto");
  assert.deepEqual(colado.alvo, { top: 4, left: 2, bottom: 5, right: 3 });
});

test("colar somente valores leva o resultado, sem fórmula nem formatação", () => {
  const colado = clip.colarRecorte(conteudo, recorte(), { row: 4, column: 0 }, "valores");
  assert.equal(colado.cells.B5, "20");
  assert.equal(colado.cells.A6, "Areia", "o que foi digitado vai como estava");
  const texto = clip.colarRecorte({ cells: { A1: '=CONCAT("1";"0")' }, bold: [] }, clip.copiarIntervalo({ cells: { A1: '=CONCAT("1";"0")' }, bold: [] }, sheet.evaluateSheet({ A1: '=CONCAT("1";"0")' }), { top: 0, left: 0, bottom: 0, right: 0 }), { row: 1, column: 0 }, "valores");
  assert.equal(texto.cells.A2, "'10", "texto calculado vai protegido para não virar número");
  assert.equal(colado.styles.A5, undefined);
  assert.equal(sheet.evaluateSheet(colado.cells).B6.value, 20);
});

test("colar somente formatação não mexe no valor", () => {
  const colado = clip.colarRecorte({ ...conteudo, cells: { ...conteudo.cells, D1: "99" } }, recorte(), { row: 0, column: 3 }, "formatacao");
  assert.equal(colado.cells.D1, "99");
  assert.deepEqual(colado.styles.D1, { italic: true });
  assert.ok(colado.bold.includes("E1"));
});

test("transposto troca linhas por colunas e leva fórmula como resultado", () => {
  const colado = clip.colarRecorte(conteudo, recorte(), { row: 5, column: 0 }, "transposto");
  assert.equal(colado.cells.A6, "10");
  assert.equal(colado.cells.B6, "Areia");
  assert.equal(colado.cells.A7, "20", "fórmula transposta vai como valor");
  assert.equal(colado.cells.B7, "20");
});

test("colar recusa sair da grade e cortar mesclagem; célula vazia no recorte limpa o destino", () => {
  assert.throws(() => clip.colarRecorte(conteudo, recorte(), { row: 499, column: 0 }, "tudo"), /não cabe/);
  assert.throws(() => clip.colarRecorte({ ...conteudo, merges: ["B6:D6"] }, recorte(), { row: 4, column: 0 }, "tudo"), /corta a mesclagem B6:D6/);
  const vazio = clip.copiarIntervalo({ cells: {}, bold: [] }, {}, { top: 0, left: 0, bottom: 0, right: 0 });
  assert.equal(clip.colarRecorte({ cells: { C3: "x" }, bold: [] }, vazio, { row: 2, column: 2 }, "tudo").cells.C3, undefined);
});

test("limpar conteúdo, formatação ou tudo, como os três Limpar do Excel", () => {
  const conteudoSo = clip.limparChaves(conteudo, ["A1", "A2"], "conteudo");
  assert.equal(conteudoSo.cells.A1, undefined);
  assert.deepEqual(conteudoSo.styles.A1, { italic: true }, "limpar conteúdo mantém a formatação");
  assert.equal(conteudoSo.notes.A2, "cotação de 12/09", "e a nota");
  const formatacao = clip.limparChaves(conteudo, ["A1", "B1"], "formatacao");
  assert.equal(formatacao.cells.A1, "10");
  assert.equal(formatacao.styles.A1, undefined);
  assert.deepEqual(formatacao.bold, []);
  assert.deepEqual(clip.limparChaves(conteudo, ["A2"], "tudo").notes, {});
  assert.equal(clip.mesmoTexto("a\tb\r\nc\r\n", "a\tb\nc"), true);
});

test("preencher à direita desloca a coluna da referência relativa", () => {
  const cells = sheet.fillRight({ A1: "=A2*$B$1", A2: "5" }, "A1", 2);
  assert.equal(cells.B1, "=B2*$B$1");
  assert.equal(cells.C1, "=C2*$B$1");
});

test("notas e ocultas: validadas no servidor e deslocadas com a estrutura", () => {
  assert.equal(contentSchema.safeParse({ notes: { A1: "ok" }, hiddenRows: [2, 3], hiddenColumns: [1] }).success, true);
  assert.equal(contentSchema.safeParse({ notes: { A1: "x".repeat(1001) } }).success, false);
  assert.equal(contentSchema.safeParse({ hiddenRows: [500] }).success, false);
  assert.equal(contentSchema.safeParse({ hiddenColumns: [52] }).success, false);
  assert.deepEqual(format.shiftIndices([2, 5], 3, 1, 500), [2, 6]);
  assert.deepEqual(format.shiftIndices([2, 5], 2, -1, 500), [4], "remover a linha oculta tira ela da lista");
  assert.equal(format.mergeCrosses(["A2:A4"], "row", [3]), "A2:A4");
  assert.equal(format.mergeCrosses(["A2:C2"], "row", [1]), null, "mesclagem numa linha só não impede ocultar a linha");
  assert.equal(format.boundsHaveHidden({ top: 0, left: 0, bottom: 3, right: 0 }, [2], []), true);
});

test("ajustar largura ao conteúdo e imprimir sem o que está oculto", () => {
  const computed = sheet.evaluateSheet({ A1: "Concreto usinado", A2: "x", B1: "oculta", C3: "fim" });
  assert.equal(tools.larguraIdeal(computed, undefined, 0, 10), Math.round(16 * 7.5 + 24));
  assert.equal(tools.larguraIdeal({}, undefined, 0, 10), 60, "coluna vazia fica no mínimo");
  const { letras, numeros } = tools.tabelaParaImpressao(computed, {}, [], 10, 10, {}, [], { linhas: [1], colunas: [1] });
  assert.deepEqual(letras, ["A", "C"]);
  assert.deepEqual(numeros, [1, 3], "a numeração preserva a linha original");
});
