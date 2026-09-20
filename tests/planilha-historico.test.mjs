import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { frase, TETO_PASSOS, TETO_CELULAS } = await vite.ssrLoadModule("/lib/sheet-history.ts");
test.after(() => vite.close());

/**
 * O que o botão de desfazer DIZ.
 *
 * O estado do histórico vive em `hooks/use-worksheet-history.ts` e é testado em
 * `worksheet-tools.test.mjs`; o comportamento na tela, em `ui-worksheets-regressions`.
 * Aqui fica só a frase — que é o contrato que as duas pontas compartilham, e a parte que
 * decide se a pessoa confia no botão antes de clicar nele.
 */

test("a frase diz o que vai voltar, não só 'desfazer'", () => {
  assert.equal(frase("Desfazer", "Excluir linha 7"), "Desfazer excluir linha 7");
  assert.equal(frase("Refazer", "Preencher para baixo"), "Refazer preencher para baixo");
  assert.equal(frase("Desfazer", "Colar 3 linhas × 4 colunas"), "Desfazer colar 3 linhas × 4 colunas");
});

test("sigla fica intacta", () => {
  // "cSV importado" se lê pior do que a maiúscula fora de lugar.
  assert.equal(frase("Desfazer", "CSV importado"), "Desfazer CSV importado");
  assert.equal(frase("Refazer", "NF emitida"), "Refazer NF emitida");
});

test("sem rótulo, a frase ainda é uma frase", () => {
  // Rótulo em branco não pode deixar o botão mudo nem produzir "Desfazer ".
  assert.equal(frase("Desfazer", ""), "Desfazer a última alteração");
  assert.equal(frase("Refazer", "   "), "Refazer a última alteração");
});

test("os tetos existem e são os dois", () => {
  // Um teto em passos sozinho encurtaria o histórico de todo mundo por causa da grade
  // cheia; o teto em células deixa a planilha normal com os 50 passos inteiros.
  assert.equal(TETO_PASSOS, 50);
  assert.equal(TETO_CELULAS, 400_000);
});
