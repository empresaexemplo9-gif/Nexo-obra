// Os parâmetros da análise financeira guardam POSIÇÕES: letra de coluna em `roles`,
// índice de linha em `headerRow` e `ignoreRows`. Inserir ou remover linha/coluna move as
// células — e, sem mover os parâmetros junto, a coluna marcada como "Custo" passa a
// apontar para a vizinha.
//
// Esse é o defeito relatado como "parâmetros falhando antes de usar". Ele não estoura:
// a leitura financeira simplesmente passa a somar a coluna errada.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { moveAnalysis } = await vite.ssrLoadModule("/lib/spreadsheet.ts");
after(() => vite.close());

const analise = (extra = {}) => ({ headerRow: 2, roles: { B: "descricao", D: "custo", F: "preco" }, ignoreRows: [5, 9], targetMarginPercent: 20, ...extra });

test("remover coluna antes do papel desloca o papel para a nova posição", () => {
  // "Custo" está em D. Removendo A, o conteúdo de D passa a ser exibido em C.
  const resultado = moveAnalysis(analise(), "column", 0, -1);
  assert.equal(resultado.roles.C, "custo", "o papel acompanha a coluna que se moveu");
  assert.equal(resultado.roles.D, undefined, "e não fica apontando para a posição antiga");
  assert.equal(resultado.roles.A, "descricao");
  assert.equal(resultado.roles.E, "preco");
});

test("inserir coluna antes do papel empurra o papel para a direita", () => {
  const resultado = moveAnalysis(analise(), "column", 0, 1);
  assert.equal(resultado.roles.E, "custo");
  assert.equal(resultado.roles.C, "descricao");
  assert.equal(resultado.roles.G, "preco");
});

test("coluna depois do papel não mexe em nada", () => {
  const resultado = moveAnalysis(analise(), "column", 20, -1);
  assert.deepEqual(resultado.roles, { B: "descricao", D: "custo", F: "preco" });
});

test("excluir a coluna marcada tira o papel, em vez de passá-lo para a vizinha", () => {
  // Herdar seria inventar uma marcação que ninguém fez — e somar a coluna errada.
  const resultado = moveAnalysis(analise(), "column", 3, -1);
  assert.equal(Object.values(resultado.roles).includes("custo"), false, "o papel 'custo' desaparece junto com a coluna");
  assert.equal(resultado.roles.E, "preco", "os demais continuam certos");
});

test("linhas: cabeçalho e linhas ignoradas acompanham a inserção", () => {
  const resultado = moveAnalysis(analise(), "row", 0, 1);
  assert.equal(resultado.headerRow, 3);
  assert.deepEqual(resultado.ignoreRows, [6, 10]);
});

test("linhas: remoção acima do cabeçalho sobe tudo", () => {
  const resultado = moveAnalysis(analise(), "row", 0, -1);
  assert.equal(resultado.headerRow, 1);
  assert.deepEqual(resultado.ignoreRows, [4, 8]);
});

test("remover uma linha ignorada tira ela da lista", () => {
  const resultado = moveAnalysis(analise(), "row", 5, -1);
  assert.equal(resultado.ignoreRows.includes(5), false, "a linha que sumiu não continua ignorada");
  assert.deepEqual(resultado.ignoreRows, [8], "e a de baixo sobe");
});

test("remover a própria linha de cabeçalho mantém o índice", () => {
  // Quem ocupou o lugar vira o cabeçalho, que é o que a tela mostra ali depois.
  const resultado = moveAnalysis(analise(), "row", 2, -1);
  assert.equal(resultado.headerRow, 2);
});

test("índice nunca fica negativo", () => {
  const resultado = moveAnalysis(analise({ headerRow: 0, ignoreRows: [0] }), "row", 0, -1);
  assert.ok(resultado.headerRow >= 0);
  assert.ok(resultado.ignoreRows.every((linha) => linha >= 0));
});

test("os demais campos da análise ficam intactos", () => {
  const resultado = moveAnalysis(analise(), "column", 0, 1);
  assert.equal(resultado.targetMarginPercent, 20);
});
