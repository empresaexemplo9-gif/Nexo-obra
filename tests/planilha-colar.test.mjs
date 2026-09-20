import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { analisarColagem, rotuloDaColagem } = await vite.ssrLoadModule("/lib/sheet-clipboard.ts");
// Quem ESCREVE a matriz na grade é o `placeTable`; aqui ele entra só para provar que o
// texto atravessa a análise e chega ao motor sem ninguém converter número no caminho.
const { placeTable } = await vite.ssrLoadModule("/lib/worksheet-tools.ts");
const { evaluateSheet } = await vite.ssrLoadModule("/lib/spreadsheet.ts");
test.after(() => vite.close());

/**
 * Colar um bloco do Excel é o caminho de entrada mais usado de uma planilha de obra. Ele
 * erra de um jeito caro: quando o formato é lido errado, a grade fica plausível e
 * embaralhada — endereço partido em três colunas, preço dividido por mil, linha de baixo
 * apagada. Este arquivo cobre cada uma dessas formas de embaralhar.
 */

const linha = (matriz, indice) => matriz[indice];

test("TSV do Excel vira matriz de linhas e colunas", () => {
  const matriz = analisarColagem("Descrição\tQtd\tUnitário\nAlvenaria\t10\t45,50");
  assert.deepEqual(matriz, [
    ["Descrição", "Qtd", "Unitário"],
    ["Alvenaria", "10", "45,50"],
  ]);
});

test("célula entre aspas guarda quebra de linha, TAB e aspa interna", () => {
  // Uma coluna de endereços sem tratamento de aspas desloca tudo o que vem depois dela.
  const matriz = analisarColagem('Cliente\tEndereço\nObra 1\t"Rua A, 100\nSala 2"\nObra 2\t"Tubo 5"" PVC"');
  assert.equal(linha(matriz, 1)[1], "Rua A, 100\nSala 2");
  assert.equal(linha(matriz, 2)[1], 'Tubo 5" PVC');
  assert.equal(matriz.length, 3);
  assert.equal(linha(matriz, 1).length, 2, "a quebra dentro da célula não abre linha nova");
});

test("\\r\\n do Windows não deixa caractere solto nem linha extra", () => {
  const matriz = analisarColagem("A\tB\r\n1\t2\r\n");
  assert.deepEqual(matriz, [["A", "B"], ["1", "2"]]);

  // O bloco copiado termina com quebra de linha; a linha vazia do fim precisa sumir, senão
  // colar duas linhas apagaria a terceira.
  const dentroDaCelula = analisarColagem('x\t"linha 1\r\nlinha 2"\r\n');
  assert.equal(linha(dentroDaCelula, 0)[1], "linha 1\nlinha 2");
  assert.equal(dentroDaCelula.length, 1);
});

test("CSV com ponto e vírgula não parte o preço na vírgula decimal", () => {
  const matriz = analisarColagem("Item;Valor\nAlvenaria;1.234,56");
  assert.deepEqual(matriz, [["Item", "Valor"], ["Alvenaria", "1.234,56"]]);
});

test("vírgula só separa quando não há TAB nem ponto e vírgula", () => {
  assert.deepEqual(analisarColagem("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
  // Com TAB presente, a vírgula é conteúdo.
  assert.deepEqual(analisarColagem("a\t1,50"), [["a", "1,50"]]);
});

test("aspa de polegada no meio do campo não engole os separadores", () => {
  // `Tubo 5" PVC` é texto de obra, não abertura de campo entre aspas.
  assert.deepEqual(analisarColagem('Tubo 5" PVC;12'), [['Tubo 5" PVC', "12"]]);
  assert.deepEqual(
    analisarColagem('Tubo 5" PVC;12\nTubo 3" PVC;8'),
    [['Tubo 5" PVC', "12"], ['Tubo 3" PVC', "8"]],
  );
});

test("clipboard vazio não é colagem", () => {
  // Matriz vazia faz a tela nem chamar o `placeTable`: apagar o destino porque alguém
  // apertou Ctrl+V com a área de transferência vazia seria pior do que não fazer nada.
  assert.deepEqual(analisarColagem(""), []);
  assert.deepEqual(analisarColagem("   \n"), []);
});

test("o rótulo diz o tamanho do bloco em português", () => {
  assert.equal(rotuloDaColagem(analisarColagem("a\tb\tc\td\n1\t2\t3\t4\n5\t6\t7\t8")), "3 linhas × 4 colunas");
  assert.equal(rotuloDaColagem([["única"]]), "1 linha × 1 coluna");
  assert.equal(rotuloDaColagem([]), "");
});

test("texto colado que começa com = continua fórmula", () => {
  // O clipboard entrega texto; quem decide o que é fórmula e o que é número é o motor.
  const matriz = analisarColagem("=SOMA(A1:A2)\t=A1*2");
  const { cells } = placeTable({ A1: "10", A2: "20" }, "A3", matriz);
  assert.equal(cells.A3, "=SOMA(A1:A2)");
  const calculado = evaluateSheet(cells);
  assert.equal(calculado.A3.value, 30);
  assert.equal(calculado.B3.value, 20);
});

test("número colado chega intacto para o motor interpretar", () => {
  const { cells } = placeTable({}, "A1", analisarColagem("1.500\t1.234,56\tR$ 89,90"));
  assert.equal(cells.A1, "1.500", "nada é convertido aqui: duas regras de número dariam dois valores");
  const calculado = evaluateSheet(cells);
  assert.equal(calculado.A1.value, 1500);
  assert.equal(calculado.B1.value, 1234.56);
  assert.equal(calculado.C1.value, 89.9);
});
