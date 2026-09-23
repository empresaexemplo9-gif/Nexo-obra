import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
const tools = await vite.ssrLoadModule("/lib/worksheet-tools.ts");
const sheet = await vite.ssrLoadModule("/lib/spreadsheet.ts");
const { worksheetHistory } = await vite.ssrLoadModule("/hooks/use-worksheet-history.ts");
const { contentSchema } = await vite.ssrLoadModule("/lib/worksheets.ts");
test.after(() => vite.close());

test("CSV preserva acentos, aspas, linhas vazias, casas decimais e quebras dentro de campos", () => {
  const table = tools.parseTable('\uFEFFNome;Valor\r\n"Obra; sul";1,234\r\n;\r\n"duas\nlinhas e ""aspas""";0\r\n', ";");
  assert.deepEqual(table, [["Nome", "Valor"], ["Obra; sul", "1,234"], ["", ""], ['duas\nlinhas e "aspas"', "0"]]);
  assert.throws(() => tools.parseTable('"aberto', ";"), /aspas/);
});
test("importação é atômica e recusa dados fora da grade e células enormes", () => {
  const cells = { A1: "original", B2: "apagar" };
  assert.throws(() => tools.placeTable(cells, "AZ500", [["1", "2"]]), /não cabe/);
  assert.throws(() => tools.placeTable(cells, "A1", [["x".repeat(2001)]]), /2.000/);
  assert.deepEqual(cells, { A1: "original", B2: "apagar" });
  assert.equal(tools.placeTable(cells, "B2", [[""]]).cells.B2, undefined);
});
test("receita executa em ordem e preserva fórmulas e valores fora da seleção", () => {
  const cells = { A1: "  obra    sul  ", A2: "=1+2", A3: "fora" };
  const result = tools.runActions(cells, ["A1", "A2"], ["trim", "upper"]);
  assert.deepEqual(result, { A1: "OBRA SUL", A2: "=1+2", A3: "fora" });
  assert.equal(cells.A1, "  obra    sul  ");
  assert.equal(tools.replaceInSelection(cells, ["A1", "A2"], "1", "2").A2, "=1+2");
});
test("conversão de valores não transforma decimal em milhar e recusa erros", () => {
  const cells = { A1: "=1,234", A2: "R$ 1.234,56", A3: "=1/0" };
  const result = tools.runActions(cells, ["A1", "A2"], ["values", "number"]);
  assert.equal(sheet.evaluateSheet(result).A1.value, 1.234);
  assert.equal(sheet.evaluateSheet(result).A2.value, 1234.56);
  assert.throws(() => tools.runActions(cells, ["A3"], ["values"]), /DIV/);
});
test("referências absolutas e mistas calculam e permanecem ao preencher", () => {
  const cells = { A1: "10", A2: "20", B1: "2", C1: "=$A$1+A1+A$1+$A1" };
  const filled = sheet.fillDown(cells, "C1", 1);
  assert.equal(filled.C2, "=$A$1+A2+A$1+$A2");
  assert.equal(sheet.evaluateSheet(filled).C2.value, 60);
  assert.equal(sheet.evaluateSheet({ ...cells, D1: "=SOMA($A$1:$A$2)" }).D1.value, 30);
  assert.equal(sheet.insertRow(cells, 0).C2, "=$A$2+A2+A$2+$A2");
  assert.equal(sheet.deleteRow({ A1: "10", A2: "=$A$1" }, 0).A1, "=#REF!");
});
test("formatação altera apenas a exibição", () => {
  const result = sheet.evaluateSheet({ A1: "0,125" }).A1;
  assert.match(tools.formattedCell(result, "percentual"), /12,5%/);
  assert.match(tools.formattedCell(result, "moeda"), /0,13/);
  assert.equal(result.value, 0.125);
});
test("desfazer mantém revisão de servidor e elimina futuro após nova edição", () => {
  const one = { id: "a", revision: 1, cells: { A1: "1" } };
  let h = worksheetHistory({ current: null, past: [], future: [] }, { type: "set", value: one });
  h = worksheetHistory(h, { type: "set", value: { ...one, cells: { A1: "2" } } });
  h = worksheetHistory(h, { type: "set", value: { ...h.current, revision: 2 } });
  h = worksheetHistory(h, { type: "undo" });
  assert.equal(h.current.cells.A1, "1"); assert.equal(h.current.revision, 2);
  h = worksheetHistory(h, { type: "redo" }); assert.equal(h.current.cells.A1, "2");
  h = worksheetHistory(h, { type: "undo" });
  h = worksheetHistory(h, { type: "set", value: { ...h.current, cells: { A1: "3" } } });
  assert.equal(h.future.length, 0);
  h = worksheetHistory(h, { type: "set", value: { ...one, id: "b" } }); assert.equal(h.past.length, 0);
});
test("receitas têm validação no servidor e conteúdo antigo continua válido", () => {
  assert.deepEqual(contentSchema.parse({}).recipes, []);
  assert.equal(contentSchema.safeParse({ recipes: [{ name: "Limpar", actions: ["trim", "number"] }] }).success, true);
  assert.equal(contentSchema.safeParse({ recipes: [{ name: "Script", actions: ["eval"] }] }).success, false);
});

test("histórico preserva conteúdo completo e reabrir a mesma planilha elimina passos antigos", () => {
  const original = { id:"a", revision:1, rows:3, columns:3, content:{cells:{B1:"12"},formats:{B:"moeda"},widths:{B:220},bold:["B1"],recipes:[{name:"Limpar",actions:["trim"]}]} };
  let history = worksheetHistory({current:null,past:[],future:[]},{type:"reset",value:original});
  history = worksheetHistory(history,{type:"set",value:{...original,columns:2,content:{...original.content,cells:{},formats:{},widths:{},bold:[]}},label:"Excluir coluna B"});
  history = worksheetHistory(history,{type:"undo"});
  assert.deepEqual(history.current,original);
  history = worksheetHistory(history,{type:"reset",value:{...original,revision:2}});
  assert.equal(history.past.length,0); assert.equal(history.future.length,0);
});

test("colar valores conserva texto literal, booleanos e erros ao copiar", () => {
  const cells = { A1: '=CONCAT("=";"1+2")', A2: "=1>2", A3: '=CONCAT("00";"123")', A4: "=1/0" };
  const next = tools.runActions(cells, ["A1", "A2", "A3"], ["values"]);
  const result = sheet.evaluateSheet(next);
  assert.equal(result.A1.value, "=1+2");
  assert.equal(result.A2.value, false);
  assert.equal(result.A3.value, "00123");
  assert.equal(tools.selectionToTsv(cells, ["A4"]), "#DIV/0!");
});

test("formato contábil põe o negativo entre parênteses e só ele fica em destaque", () => {
  const [negativo, positivo] = [{ value: -1500.5, error: null, display: "-1500,5" }, { value: 20, error: null, display: "20" }];
  assert.equal(tools.formattedCell(negativo, "contabil").replace(/\s/g, " "), "(R$ 1.500,50)");
  assert.equal(tools.formattedCell(positivo, "contabil").replace(/\s/g, " "), "R$ 20,00");
  assert.equal(tools.negativoEmDestaque(negativo, "contabil"), true);
  assert.equal(tools.negativoEmDestaque(negativo, "moeda"), false, "desvio negativo pode ser economia: só o contábil pinta");
  assert.equal(tools.negativoEmDestaque(positivo, "contabil"), false);
  assert.equal(contentSchema.safeParse({ formats: { A: "contabil" } }).success, true);
});

test("sugestão de função completa o nome digitado no fim da fórmula", () => {
  assert.deepEqual(tools.sugestoesDeFuncao("=SO"), { parcial: "SO", funcoes: ["SOMA", "SOMASE"] });
  assert.deepEqual(tools.sugestoesDeFuncao("=A1+méd").funcoes, ["MEDIA", "MEDIANA"], "acento e minúscula não atrapalham");
  assert.deepEqual(tools.sugestoesDeFuncao("=SE(A1>0;ar").funcoes, ["ARRED"]);
  assert.deepEqual(tools.sugestoesDeFuncao("=A1").funcoes, [], "referência completa não sugere");
  assert.deepEqual(tools.sugestoesDeFuncao("SO").funcoes, [], "fora de fórmula não sugere");
  assert.deepEqual(tools.sugestoesDeFuncao('=CONCAT("so').funcoes, [], "dentro de texto não sugere");
  assert.deepEqual(tools.sugestoesDeFuncao("=SOMA").funcoes, ["SOMASE"], "o nome completo não se sugere de novo");
  assert.equal(tools.aplicarSugestao("=A1+méd", "méd", "MEDIA"), "=A1+MEDIA(");
});

test("impressão leva os valores formatados, recortados até a última célula preenchida", () => {
  const cells = { A1: "Item", B1: "Total", A2: "Areia", B2: "=10*-3", D9: "" };
  const { letras, linhas } = tools.tabelaParaImpressao(sheet.evaluateSheet(cells), { B: "contabil" }, ["A1"], 12, 60);
  assert.deepEqual(letras, ["A", "B"]);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0][0].negrito, true);
  assert.equal(linhas[1][1].texto.replace(/\s/g, " "), "(R$ 30,00)");
  assert.equal(linhas[1][1].numero, true);
  assert.equal(linhas[1][1].negativo, true);
  assert.deepEqual(tools.tabelaParaImpressao({}, {}, [], 12, 60), { letras: [], linhas: [] });
});

test("colunas fixas: no máximo duas, e zero por padrão", () => {
  assert.equal(contentSchema.parse({}).frozenColumns, 0);
  assert.equal(contentSchema.safeParse({ frozenColumns: 2 }).success, true);
  assert.equal(contentSchema.safeParse({ frozenColumns: 3 }).success, false);
});
