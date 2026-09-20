import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const {
  criarHistorico: criarHistoricoBase, registrar: registrarBase,
  desfazer, refazer, podeDesfazer, podeRefazer,
  rotuloDoProximoDesfazer, rotuloDoProximoRefazer, TETO_PASSOS, TETO_CELULAS,
} = await vite.ssrLoadModule("/lib/sheet-history.ts");
const { deleteColumn, fillDown, cellKey, columnName } = await vite.ssrLoadModule("/lib/spreadsheet.ts");
test.after(() => vite.close());

/**
 * Os testes abaixo falam de CÉLULAS. A forma da grade — linhas, colunas, parâmetros de
 * análise — viaja junto no histórico e tem teste próprio no fim deste arquivo; aqui ela
 * fica constante para não poluir cada asserção com um campo que não é o assunto.
 */
const FORMA = { rows: 10, columns: 5, analysis: { headerRow: 0, roles: {}, ignoreRows: [] } };
const criarHistorico = (cells) => criarHistoricoBase({ cells, forma: FORMA });
const registrar = (historico, cells, rotulo) => registrarBase(historico, { cells, forma: FORMA }, rotulo);

/**
 * Apagar uma coluna por engano ou errar o preenchimento para baixo era perda definitiva:
 * a planilha só tinha o estado atual. Este arquivo cobre o que precisa ser verdade para
 * o botão desfazer merecer confiança — inclusive não acender quando não tem o que fazer.
 */

const cheia = (colunas, linhas) => {
  const cells = {};
  for (let coluna = 0; coluna < colunas; coluna += 1) {
    for (let linha = 0; linha < linhas; linha += 1) cells[cellKey({ column: coluna, row: linha })] = "1.234,56";
  }
  return cells;
};

test("desfazer devolve o estado anterior e diz o que foi desfeito", () => {
  const inicial = { A1: "Alvenaria", B1: "1200" };
  let historico = criarHistorico(inicial);
  assert.equal(podeDesfazer(historico), false, "planilha recém-aberta não tem o que desfazer");

  historico = registrar(historico, { A1: "Alvenaria" }, "Excluir coluna B");
  assert.equal(podeDesfazer(historico), true);

  const volta = desfazer(historico);
  assert.deepEqual(volta.cells, inicial);
  assert.equal(volta.rotulo, "Excluir coluna B");
  assert.equal(podeDesfazer(volta.historico), false);
  assert.equal(podeRefazer(volta.historico), true);
});

test("refazer devolve exatamente o que o desfazer tirou", () => {
  let historico = criarHistorico({ A1: "10" });
  historico = registrar(historico, { A1: "10", A2: "20" }, "Preencher para baixo");

  const volta = desfazer(historico);
  const frente = refazer(volta.historico);
  assert.deepEqual(frente.cells, { A1: "10", A2: "20" });
  assert.equal(frente.rotulo, "Preencher para baixo");
  assert.equal(refazer(frente.historico), null, "no topo da pilha não há para onde ir");
  assert.equal(podeRefazer(frente.historico), false);
});

test("nas bordas o movimento devolve null em vez de repetir o mesmo estado", () => {
  const historico = criarHistorico({ A1: "10" });
  assert.equal(desfazer(historico), null);
  assert.equal(refazer(historico), null);
});

test("registrar um estado idêntico ao topo não cria passo", () => {
  // Sem isto, o usuário aperta desfazer e a planilha não muda na tela: o botão passa a
  // mentir, e ele aperta de novo até desfazer trabalho de verdade.
  const historico = criarHistorico({ A1: "10", B1: "20" });
  const igual = registrar(historico, { B1: "20", A1: "10" }, "Colar 1 linha × 2 colunas");
  assert.equal(igual, historico, "mesmo conteúdo em outra ordem de chave continua sendo o mesmo topo");
  assert.equal(podeDesfazer(igual), false);
});

test("célula apagada e célula ausente são a mesma planilha", () => {
  // `evaluateSheet`, `sortRows` e `axisLastFilled` tratam "" e undefined igual: digitar e
  // apagar de volta deixa a grade idêntica na tela, então também não vira passo.
  const historico = criarHistorico({ A1: "10" });
  assert.equal(registrar(historico, { A1: "10", B1: "" }, "Digitar B1"), historico);
  assert.equal(registrar(criarHistorico({ A1: "10", B1: "" }), { A1: "10" }, "Apagar B1").passos.length, 1);

  const mudou = registrar(historico, { A1: "10", B1: "20" }, "Digitar B1");
  assert.equal(podeDesfazer(mudou), true, "conteúdo novo continua virando passo");
});

test("o histórico não compartilha objeto mutável com a tela", () => {
  const daTela = { A1: "10" };
  let historico = criarHistorico(daTela);
  historico = registrar(historico, { A1: "10", A2: "20" }, "Digitar A2");

  // A tela segue editando o objeto que entregou; o passado não pode acompanhar.
  daTela.A1 = "999";
  daTela.Z9 = "lixo";

  const volta = desfazer(historico);
  assert.deepEqual(volta.cells, { A1: "10" });

  // E o que sai também é solto: mexer nele não reescreve o passo guardado.
  volta.cells.A1 = "888";
  assert.deepEqual(desfazer(historico).cells, { A1: "10" });
});

test("editar depois de desfazer descarta o caminho da frente", () => {
  let historico = criarHistorico({ A1: "1" });
  historico = registrar(historico, { A1: "2" }, "Digitar A1");
  historico = registrar(historico, { A1: "3" }, "Digitar A1 de novo");

  const volta = desfazer(historico);
  assert.deepEqual(volta.cells, { A1: "2" });

  const novoRumo = registrar(volta.historico, { A1: "9" }, "Excluir linha 7");
  assert.equal(podeRefazer(novoRumo), false, "o caminho para A1=3 deixou de existir");
  assert.deepEqual(desfazer(novoRumo).cells, { A1: "2" });
});

test("estourar o teto de passos mantém a ordem e o passo mais recente", () => {
  let historico = criarHistorico({ A1: "0" });
  const total = TETO_PASSOS + 10;
  for (let passo = 1; passo <= total; passo += 1) historico = registrar(historico, { A1: String(passo) }, `Digitar ${passo}`);

  assert.equal(rotuloDoProximoDesfazer(historico), `Desfazer digitar ${total}`, "o mais recente sobreviveu");

  const visitados = [];
  let cursor = historico;
  for (;;) {
    const volta = desfazer(cursor);
    if (!volta) break;
    visitados.push(volta.cells.A1);
    cursor = volta.historico;
  }

  assert.equal(visitados.length, TETO_PASSOS, "o teto é o número de passos que dá para desfazer");
  assert.deepEqual(visitados.slice(0, 3), [String(total - 1), String(total - 2), String(total - 3)], "a ordem é a da edição");
  assert.equal(visitados.at(-1), String(total - TETO_PASSOS), "o mais antigo saiu pela frente, não pelo meio");
  assert.equal(podeDesfazer(cursor), false);
});

test("o orçamento de células segura a grade cheia", () => {
  // 52 × 500 custa ~1,5 MB por passo: 50 passos seriam 75 MB no navegador. O histórico
  // encurta em vez de crescer sem limite, e continua desfazendo o trabalho recente.
  const base = cheia(52, 500);
  assert.equal(Object.keys(base).length, 26000);

  let historico = criarHistorico(base);
  for (let passo = 1; passo <= 30; passo += 1) historico = registrar(historico, { ...base, A1: String(passo) }, `Digitar ${passo}`);

  const guardadas = historico.passos.reduce((soma, atual) => soma + Object.keys(atual.cells).length, 0);
  assert.equal(guardadas <= TETO_CELULAS, true, `o histórico guardou ${guardadas} células`);
  assert.equal(historico.passos.length < TETO_PASSOS + 1, true, "com a grade cheia, o orçamento aperta antes do teto de passos");
  assert.equal(podeDesfazer(historico), true, "apertar não é zerar: o trabalho recente continua reversível");
  assert.equal(desfazer(historico).cells.A1, "29");
});

test("o rótulo do botão diz o que vai acontecer", () => {
  // Botão que não diz o que vai desfazer obriga a clicar para descobrir, e descobrir
  // errado é outra perda.
  let historico = criarHistorico({ A1: "10" });
  assert.equal(rotuloDoProximoDesfazer(historico), "Nada para desfazer");
  assert.equal(rotuloDoProximoRefazer(historico), "Nada para refazer");

  historico = registrar(historico, { A1: "10", A2: "20" }, "Excluir linha 7");
  assert.equal(rotuloDoProximoDesfazer(historico), "Desfazer excluir linha 7");

  const volta = desfazer(historico);
  assert.equal(rotuloDoProximoRefazer(volta.historico), "Refazer excluir linha 7");
  assert.equal(rotuloDoProximoDesfazer(volta.historico), "Nada para desfazer");
});

test("sigla não vira minúscula no meio da frase", () => {
  const historico = registrar(criarHistorico({}), { A1: "10" }, "CSV importado");
  assert.equal(rotuloDoProximoDesfazer(historico), "Desfazer CSV importado");
});

test("rótulo em branco não deixa o botão mudo", () => {
  const historico = registrar(criarHistorico({}), { A1: "10" }, "   ");
  assert.equal(rotuloDoProximoDesfazer(historico), "Desfazer a última alteração");
});

test("desfaz as operações reais da planilha, com fórmula e tudo", () => {
  // O caso que motivou a camada: excluir a coluna errada reescreve as fórmulas vizinhas,
  // e sem histórico não há como voltar do #REF!.
  const original = { A1: "10", B1: "2", C1: "=A1*B1", C2: "=C1+1" };
  let historico = criarHistorico(original);

  const semB = deleteColumn(original, 1);
  historico = registrar(historico, semB, `Excluir coluna ${columnName(1)}`);
  assert.equal(semB.B1, "=A1*#REF!", "a exclusão levou a fórmula junto");

  const comPreenchimento = fillDown(semB, "A1", 3);
  historico = registrar(historico, comPreenchimento, "Preencher para baixo");
  assert.equal(comPreenchimento.A3, "10");

  assert.equal(rotuloDoProximoDesfazer(historico), "Desfazer preencher para baixo");
  const primeiro = desfazer(historico);
  assert.deepEqual(primeiro.cells, semB);

  const segundo = desfazer(primeiro.historico);
  assert.deepEqual(segundo.cells, original, "a coluna excluída volta inteira, com a fórmula original");
  assert.equal(rotuloDoProximoRefazer(segundo.historico), "Refazer excluir coluna B");
});

/**
 * A forma da grade viaja junto — e precisa viajar.
 *
 * Excluir uma coluna não mexe só nas células: mexe em `columns`, e mexe nos parâmetros
 * de análise, que guardam POSIÇÕES (qual linha é o cabeçalho, qual coluna é o custo).
 * Um histórico só de células desfazia a exclusão devolvendo o conteúdo numa grade que
 * continuava encolhida — a coluna voltava e não aparecia — e com "Custo" apontando para
 * a vizinha, sem erro nenhum na tela.
 */
test("desfazer devolve a grade do tamanho que ela tinha", () => {
  const antes = {
    cells: { A1: "Etapa", B1: "Custo", B2: "1000" },
    forma: { rows: 10, columns: 5, analysis: { headerRow: 0, roles: { B: "custo" }, ignoreRows: [] } },
  };
  const depois = {
    cells: { A1: "Etapa" },
    forma: { rows: 10, columns: 4, analysis: { headerRow: 0, roles: {}, ignoreRows: [] } },
  };

  const historico = registrarBase(criarHistoricoBase(antes), depois, "Excluir coluna B");
  const volta = desfazer(historico);

  assert.deepEqual(volta.cells, antes.cells);
  assert.equal(volta.forma.columns, 5, "a coluna volta, e a grade volta a caber nela");
  assert.deepEqual(volta.forma.analysis.roles, { B: "custo" }, "o papel volta para a coluna certa");

  const refeito = refazer(volta.historico);
  assert.equal(refeito.forma.columns, 4);
  assert.deepEqual(refeito.forma.analysis.roles, {});
});

test("mudança que só mexe na forma também vira passo", () => {
  // Inserir coluna depois da última não toca célula nenhuma. Comparando só as células,
  // este passo não era registrado e desfazer pulava por cima dele.
  const base = { cells: { A1: "10" }, forma: { rows: 10, columns: 5 } };
  const maior = { cells: { A1: "10" }, forma: { rows: 10, columns: 6 } };

  const historico = registrarBase(criarHistoricoBase(base), maior, "Inserir coluna F");
  assert.equal(historico.passos.length, 2);
  assert.equal(desfazer(historico).forma.columns, 5);
});

test("forma idêntica com células idênticas continua não virando passo", () => {
  const estado = { cells: { A1: "10" }, forma: { rows: 10, columns: 5 } };
  const historico = criarHistoricoBase(estado);
  assert.equal(registrarBase(historico, { cells: { A1: "10" }, forma: { rows: 10, columns: 5 } }, "Nada"), historico);
});
