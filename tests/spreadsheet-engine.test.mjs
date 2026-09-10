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
