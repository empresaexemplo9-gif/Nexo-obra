import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const sheet = await vite.ssrLoadModule("/lib/spreadsheet.ts");
test.after(() => vite.close());

const value = (cells, key) => sheet.evaluateSheet(cells)[key]?.value;
const shown = (cells, key) => sheet.evaluateSheet(cells)[key]?.display;

test("soma valores digitados com os dois separadores usados no Brasil", () => {
  const cells = { A1: "1.234,56", A2: "2000", A3: "R$ 765,44", A4: "=SOMA(A1:A3)" };
  assert.equal(value(cells, "A4"), 4000);
  assert.equal(shown(cells, "A4"), "4.000");
  assert.equal(value({ A1: "10", A2: "2,5", A3: "=A1*A2" }, "A3"), 25);
});

test("faz as contas de orçamento sem erro de arredondamento no centavo", () => {
  const cells = {
    A1: "12", B1: "89,90", C1: "=A1*B1",
    A2: "3", B2: "1.250,35", C2: "=A2*B2",
    C3: "=SOMA(C1:C2)",
    C4: "=ARRED(C3*0,25;2)",
    C5: "=ARRED(C3+C4;2)",
  };
  assert.equal(value(cells, "C1"), 1078.8);
  assert.equal(value(cells, "C2"), 3751.05);
  assert.equal(value(cells, "C3"), 4829.85);
  assert.equal(value(cells, "C4"), 1207.46);
  assert.equal(value(cells, "C5"), 6037.31);
});

test("ARRED resolve o meio-centavo do jeito esperado, sem herdar o erro binário", () => {
  assert.equal(value({ A1: "=ARRED(1,005;2)" }, "A1"), 1.01);
  assert.equal(value({ A1: "=ARRED(2,675;2)" }, "A1"), 2.68);
  assert.equal(value({ A1: "=ARRED(1234,5678;0)" }, "A1"), 1235);
});

test("aceita nomes de função em português e em inglês", () => {
  const cells = { A1: "10", A2: "20", A3: "30", B1: "=SOMA(A1:A3)", B2: "=SUM(A1:A3)", B3: "=MEDIA(A1:A3)", B4: "=AVERAGE(A1:A3)", B5: "=MÁXIMO(A1:A3)" };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.B1.value, 60);
  assert.equal(computed.B2.value, 60);
  assert.equal(computed.B3.value, 20);
  assert.equal(computed.B4.value, 20);
  assert.equal(computed.B5.value, 30);
});

test("condicionais e filtros funcionam sobre os dados reais da planilha", () => {
  const cells = {
    A1: "Obra Alfa", B1: "receber", C1: "1500",
    A2: "Obra Beta", B2: "pagar", C2: "900",
    A3: "Obra Alfa", B3: "receber", C3: "2500",
    E1: '=SOMASE(B1:B3;"receber";C1:C3)',
    E2: '=CONT.SE(A1:A3;"Obra Alfa")',
    E3: '=SE(E1>3000;"Meta batida";"Abaixo da meta")',
    E4: '=SOMASE(C1:C3;">1000")',
    E5: '=PROCV("Obra Beta";A1:C3;3)',
  };
  const computed = sheet.evaluateSheet(cells);
  assert.equal(computed.E1.value, 4000);
  assert.equal(computed.E2.value, 2);
  assert.equal(computed.E3.value, "Meta batida");
  assert.equal(computed.E4.value, 4000);
  assert.equal(computed.E5.value, 900);
});

test("percentuais, potências e texto compõem no mesmo cálculo", () => {
  assert.equal(value({ A1: "200", A2: "=A1*15%" }, "A2"), 30);
  assert.equal(value({ A1: "=2^10" }, "A1"), 1024);
  assert.equal(value({ A1: "=RAIZ(144)" }, "A1"), 12);
  assert.equal(value({ A1: "Obra", A2: "=MAIUSCULA(A1)&\" 01\"" }, "A2"), "OBRA 01");
  assert.equal(value({ A1: "=NUM.CARACT(\"orçamento\")" }, "A1"), 9);
});

test("recalcula cadeias longas e acompanha a mudança de uma célula só", () => {
  const cells = { A1: "5" };
  for (let row = 2; row <= 40; row += 1) cells[`A${row}`] = `=A${row - 1}+1`;
  assert.equal(value(cells, "A40"), 44);
  assert.equal(value({ ...cells, A1: "100" }, "A40"), 139);
});

test("erros aparecem na célula sem derrubar o resto da planilha", () => {
  const computed = sheet.evaluateSheet({
    A1: "=1/0", A2: "=NAOEXISTE(1)", A3: "=A3+1", A4: "=SOMA(", A5: "10", A6: "=A5*2",
  });
  assert.equal(computed.A1.error, "#DIV/0!");
  assert.equal(computed.A2.error, "#NOME?");
  assert.equal(computed.A3.error, "#CIRCULAR!");
  assert.equal(computed.A4.error, "#FÓRMULA!");
  assert.equal(computed.A6.value, 20, "uma célula quebrada não contamina as demais");
});

test("referência circular indireta também é barrada", () => {
  const computed = sheet.evaluateSheet({ A1: "=B1+1", B1: "=C1+1", C1: "=A1+1" });
  assert.ok([computed.A1.error, computed.B1.error, computed.C1.error].some((error) => error === "#CIRCULAR!"));
});

test("exporta CSV com o valor calculado, não com a fórmula", () => {
  const csv = sheet.sheetToCsv({ A1: "Item", B1: "Total", A2: "Piso", B2: "=25*4" }, 2, 3);
  assert.equal(csv, "Item;Total\nPiso;100");
});

test("endereços de célula e colunas seguem a convenção da planilha", () => {
  assert.equal(sheet.columnName(0), "A");
  assert.equal(sheet.columnName(25), "Z");
  assert.equal(sheet.columnName(26), "AA");
  assert.equal(sheet.columnIndex("AA"), 26);
  assert.deepEqual(sheet.parseCellKey("C7"), { column: 2, row: 6 });
  assert.equal(sheet.parseCellKey("7C"), null);
});

test("inserir linha empurra os dados e conserta as fórmulas", () => {
  const cells = { A1: "10", A2: "20", A3: "=SOMA(A1:A2)", B3: "=A1*2" };
  const next = sheet.insertRow(cells, 1);
  assert.equal(next.A1, "10");
  assert.equal(next.A3, "20", "o que estava na linha 2 desce para a 3");
  assert.equal(next.A4, "=SOMA(A1:A3)", "a faixa acompanha a linha inserida");
  assert.equal(next.B4, "=A1*2", "referência acima do ponto de inserção não muda");
  assert.equal(sheet.evaluateSheet(next).A4.value, 30);
});

test("remover linha reajusta as fórmulas e marca o que apontava para ela", () => {
  const cells = { A1: "10", A2: "20", A3: "30", A4: "=SOMA(A1:A3)", B1: "=A2+1" };
  const next = sheet.deleteRow(cells, 1);
  assert.equal(next.A2, "30");
  assert.equal(next.A3, "=SOMA(A1:A2)");
  assert.equal(next.B1, "=#REF!+1", "a fórmula que apontava para a linha removida avisa em vez de somar errado");
  assert.equal(sheet.evaluateSheet(next).A3.value, 40);
});

test("inserir e remover coluna seguem a mesma regra", () => {
  const inserida = sheet.insertColumn({ A1: "5", B1: "=A1*2" }, 1);
  assert.equal(inserida.A1, "5");
  assert.equal(inserida.C1, "=A1*2");
  const removida = sheet.deleteColumn({ A1: "5", B1: "7", C1: "=A1+B1" }, 1);
  assert.equal(removida.B1, "=A1+#REF!");
});

test("preencher para baixo desloca a referência relativa", () => {
  const cells = { A1: "2", A2: "3", A3: "4", B1: "=A1*10" };
  const next = sheet.fillDown(cells, "B1", 2);
  assert.equal(next.B2, "=A2*10");
  assert.equal(next.B3, "=A3*10");
  const computed = sheet.evaluateSheet(next);
  assert.equal(computed.B3.value, 40);
});

test("ordenar reorganiza as linhas e recusa quando há fórmula na faixa", () => {
  const cells = {
    A1: "Setor", B1: "Valor",
    A2: "Obra", B2: "300",
    A3: "Projeto", B3: "100",
    A4: "Consultoria", B4: "200",
  };
  const crescente = sheet.sortRows(cells, { columns: 2, rows: 6, headerRow: 0, column: 1, direction: "asc" });
  assert.equal(crescente.blocked, false);
  assert.equal(crescente.cells.A1, "Setor", "o cabeçalho fica onde está");
  assert.deepEqual([crescente.cells.B2, crescente.cells.B3, crescente.cells.B4], ["100", "200", "300"]);
  assert.equal(crescente.cells.A2, "Projeto", "a linha inteira anda junto com o valor");

  const decrescente = sheet.sortRows(cells, { columns: 2, rows: 6, headerRow: 0, column: 1, direction: "desc" });
  assert.deepEqual([decrescente.cells.B2, decrescente.cells.B3, decrescente.cells.B4], ["300", "200", "100"]);

  const ligaLinhas = sheet.sortRows({ ...cells, B4: "=B3+100" }, { columns: 2, rows: 6, headerRow: 0, column: 1, direction: "asc" });
  assert.equal(ligaLinhas.blocked, true, "fórmula que liga uma linha a outra recusa em vez de embaralhar o cálculo");
  assert.equal(ligaLinhas.cells.B4, "=B3+100", "e não altera nada");

  const deFora = sheet.sortRows({ ...cells, D1: "=B3" }, { columns: 2, rows: 6, headerRow: 0, column: 1, direction: "asc" });
  assert.equal(deFora.blocked, true, "célula fora do bloco apontando para uma linha dele também recusa");
});

test("ordenar planilha de modelo move as fórmulas da própria linha e mantém o total fixo", () => {
  // Todo modelo tem fórmula em todas as linhas de dados. Antes, ordenar recusava sempre.
  const cells = {
    A1: "Item", B1: "Qtd", C1: "Unit", D1: "Total",
    A2: "Areia", B2: "3", C2: "100", D2: '=SE(B2="";"";B2*C2)',
    A3: "Cimento", B3: "10", C3: "40", D3: '=SE(B3="";"";B3*C3)',
    D4: '=SE(B4="";"";B4*C4)',
    A5: "Brita", B5: "1", C5: "90", D5: '=SE(B5="";"";B5*C5)',
    A6: "Total", D6: "=SOMA(D2:D5)",
  };
  const antes = sheet.evaluateSheet(cells).D6.value;
  const ordenado = sheet.sortRows(cells, { columns: 4, rows: 8, headerRow: 0, column: 3, direction: "desc", fixedRows: [5] });
  assert.equal(ordenado.blocked, false);
  assert.deepEqual([ordenado.cells.A2, ordenado.cells.A3, ordenado.cells.A4], ["Cimento", "Areia", "Brita"]);
  assert.equal(ordenado.cells.D2, '=SE(B2="";"";B2*C2)', "a fórmula aponta para a linha nova");
  assert.equal(ordenado.cells.D5, '=SE(B5="";"";B5*C5)', "linha só com fórmula do modelo vai para o fim");
  assert.equal(ordenado.cells.A5, undefined);
  assert.equal(ordenado.cells.D6, "=SOMA(D2:D5)", "a linha de total fica onde está");
  assert.equal(sheet.evaluateSheet(ordenado.cells).D6.value, antes, "e o total não muda");

  const crescente = sheet.sortRows(cells, { columns: 4, rows: 8, headerRow: 0, column: 0, direction: "asc", fixedRows: [5] });
  assert.deepEqual([crescente.cells.A2, crescente.cells.A3, crescente.cells.A4], ["Areia", "Brita", "Cimento"]);
});

test("ordenar põe números antes de texto e vazios no fim nas duas direções", () => {
  const cells = { A1: "V", A2: "b", A3: "10", A4: "a", A5: "2", B6: "x" };
  const asc = sheet.sortRows(cells, { columns: 2, rows: 7, headerRow: 0, column: 0, direction: "asc" });
  assert.deepEqual([2, 3, 4, 5, 6].map((row) => asc.cells[`A${row}`] ?? asc.cells[`B${row}`]), ["2", "10", "a", "b", "x"]);
  const desc = sheet.sortRows(cells, { columns: 2, rows: 7, headerRow: 0, column: 0, direction: "desc" });
  assert.deepEqual([2, 3, 4, 5, 6].map((row) => desc.cells[`A${row}`] ?? desc.cells[`B${row}`]), ["10", "2", "b", "a", "x"]);
});

test("texto entre aspas não é confundido com endereço ao reajustar", () => {
  const next = sheet.insertRow({ A5: '=SE(A1>0;"B2 aprovado";A2)' }, 1);
  assert.equal(next.A6, '=SE(A1>0;"B2 aprovado";A3)');
});

test("0.125 é decimal, não cento e vinte e cinco", () => {
  assert.equal(sheet.parseNumber("0.125"), 0.125);
  assert.equal(sheet.parseNumber("1.500"), 1500, "grupo de três com dígito inicial continua milhar");
});
