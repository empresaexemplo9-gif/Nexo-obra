import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { analisarColagem, aplicarColagem, rotuloDaColagem, LIMITE_CARACTERES_CELULA } = await vite.ssrLoadModule("/lib/sheet-clipboard.ts");
const { evaluateSheet, cellKey, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } = await vite.ssrLoadModule("/lib/spreadsheet.ts");
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
  assert.deepEqual(analisarColagem(""), []);
  assert.deepEqual(analisarColagem("   \n"), []);
  const resultado = aplicarColagem({ A1: "mantida" }, "A1", analisarColagem(""));
  assert.deepEqual(resultado.cells, { A1: "mantida" }, "apagar o destino sem ninguém pedir seria pior");
  assert.deepEqual(resultado.alterados, []);
});

test("a matriz é escrita a partir da âncora", () => {
  const matriz = analisarColagem("Alvenaria\t10\nPintura\t4");
  const resultado = aplicarColagem({}, "B2", matriz);
  assert.deepEqual(resultado.cells, { B2: "Alvenaria", C2: "10", B3: "Pintura", C3: "4" });
  assert.deepEqual(resultado.alterados.sort(), ["B2", "B3", "C2", "C3"]);
  assert.equal(resultado.truncado, null);
});

test("célula vazia da matriz apaga o destino sem criar chave vazia", () => {
  const resultado = aplicarColagem({ A1: "10", B1: "20", C1: "30" }, "A1", [["", "novo"]]);
  assert.equal("A1" in resultado.cells, false, "chave vazia confunde quem lê ausência como vazio");
  assert.equal(resultado.cells.B1, "novo");
  assert.equal(resultado.cells.C1, "30", "fora do bloco colado nada é tocado");
  assert.deepEqual(resultado.alterados.sort(), ["A1", "B1"]);
});

test("colar o mesmo conteúdo não suja a planilha", () => {
  const cells = { A1: "10" };
  const resultado = aplicarColagem(cells, "A1", [["10"]]);
  assert.deepEqual(resultado.alterados, []);
  assert.equal(resultado.cells, cells, "sem mudança, a mesma referência evita salvamento à toa");
});

test("o que não cabe em colunas é descartado e relatado", () => {
  const larga = [Array.from({ length: SHEET_MAX_COLUMNS + 3 }, (_, i) => `c${i}`)];
  const resultado = aplicarColagem({}, "A1", larga);
  assert.deepEqual(resultado.truncado, { colunas: 3, linhas: 0 });
  assert.equal(resultado.cells[cellKey({ column: SHEET_MAX_COLUMNS - 1, row: 0 })], `c${SHEET_MAX_COLUMNS - 1}`);
  assert.equal(Object.keys(resultado.cells).length, SHEET_MAX_COLUMNS, "nada foi gravado fora da grade");

  // A âncora consome espaço: o mesmo bloco colado uma coluna à frente perde mais uma.
  const deslocada = aplicarColagem({}, "B1", [Array.from({ length: SHEET_MAX_COLUMNS }, () => "x")]);
  assert.deepEqual(deslocada.truncado, { colunas: 1, linhas: 0 });
});

test("o que não cabe em linhas é descartado e relatado", () => {
  const alta = Array.from({ length: 5 }, (_, i) => [`linha ${i}`]);
  const resultado = aplicarColagem({}, `A${SHEET_MAX_ROWS - 1}`, alta);
  assert.deepEqual(resultado.truncado, { colunas: 0, linhas: 3 });
  assert.equal(resultado.cells[`A${SHEET_MAX_ROWS}`], "linha 1");
  assert.equal(Object.keys(resultado.cells).length, 2);
});

test("limite pedido pela interface nunca passa do limite da grade", () => {
  // Interface não define teto: a grade é a que `cellKey` e o schema sabem endereçar.
  const larga = [Array.from({ length: SHEET_MAX_COLUMNS + 5 }, () => "x")];
  const resultado = aplicarColagem({}, "A1", larga, { colunas: 999, linhas: 9999 });
  assert.deepEqual(resultado.truncado, { colunas: 5, linhas: 0 });

  // E um limite menor, vindo da planilha aberta, é respeitado.
  const estreita = aplicarColagem({}, "A1", [["a", "b", "c"]], { colunas: 2 });
  assert.deepEqual(estreita.truncado, { colunas: 1, linhas: 0 });
  assert.deepEqual(Object.keys(estreita.cells), ["A1", "B1"]);
});

test("texto colado que começa com = continua fórmula", () => {
  // O clipboard entrega texto; quem decide o que é fórmula e o que é número é o motor.
  const matriz = analisarColagem("=SOMA(A1:A2)\t=A1*2");
  const { cells } = aplicarColagem({ A1: "10", A2: "20" }, "A3", matriz);
  assert.equal(cells.A3, "=SOMA(A1:A2)");
  const calculado = evaluateSheet(cells);
  assert.equal(calculado.A3.value, 30);
  assert.equal(calculado.B3.value, 20);
});

test("número colado chega intacto para o motor interpretar", () => {
  const { cells } = aplicarColagem({}, "A1", analisarColagem("1.500\t1.234,56\tR$ 89,90"));
  assert.equal(cells.A1, "1.500", "nada é convertido aqui: duas regras de número dariam dois valores");
  const calculado = evaluateSheet(cells);
  assert.equal(calculado.A1.value, 1500);
  assert.equal(calculado.B1.value, 1234.56);
  assert.equal(calculado.C1.value, 89.9);
});

test("célula longa demais é cortada e avisada, em vez de derrubar o salvamento", () => {
  // Acima de 2000 caracteres o schema recusa o conteúdo inteiro: a colagem pareceria ter
  // dado certo e todo o trabalho seguinte morreria no 400.
  const enorme = "a".repeat(LIMITE_CARACTERES_CELULA + 500);
  const resultado = aplicarColagem({}, "A1", [[enorme]]);
  assert.equal(resultado.cells.A1.length, LIMITE_CARACTERES_CELULA);
  assert.deepEqual(resultado.cortadas, ["A1"]);

  const curta = aplicarColagem({}, "A1", [["ok"]]);
  assert.deepEqual(curta.cortadas, []);
});

test("o rótulo diz o tamanho do bloco em português", () => {
  assert.equal(rotuloDaColagem(analisarColagem("a\tb\tc\td\n1\t2\t3\t4\n5\t6\t7\t8")), "3 linhas × 4 colunas");
  assert.equal(rotuloDaColagem([["única"]]), "1 linha × 1 coluna");
  assert.equal(rotuloDaColagem([]), "");
});
