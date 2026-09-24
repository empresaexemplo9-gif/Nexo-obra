import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { findByText, installDom, stubFetch, textOf } from "./dom-harness.mjs";

const dom = installDom();
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: {
  "@": root,
  "next/image": fileURLToPath(new URL("./stubs/next-image.mjs", import.meta.url)),
  "next/link": fileURLToPath(new URL("./stubs/next-link.mjs", import.meta.url)),
} }, server: { middlewareMode: true } });
const { WorksheetsWorkspace } = await vite.ssrLoadModule("/components/worksheets-workspace.tsx");
after(async () => { await vite.close(); dom.cleanup(); });

let container; let reactRoot;
beforeEach(async () => {
  // Desmontar a raiz anterior: removida do DOM ela continuava viva, com os ouvintes de
  // `window` e `document` respondendo aos eventos do teste seguinte.
  if (reactRoot) await act(async () => { reactRoot.unmount(); });
  document.body.replaceChildren();
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container);
});

const settle = async () => {
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
};

test("automação mostra prévia, aplica na seleção e permite desfazer e refazer", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "  obra   sul  ", B1: "preservar" } } });
  const choose = container.querySelector('[aria-label="Adicionar ação"]');
  await act(async () => { choose.value = "trim"; choose.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await act(async () => { choose.value = "upper"; choose.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await act(async () => { findByText(container, /Prévia da automação/, "button").click(); });
  assert.equal(container.querySelector("#cell-A1").textContent, "  obra   sul  ");
  assert.match(textOf(container), /OBRA SUL/);
  await act(async () => { findByText(container, /Aplicar alterações/, "button").click(); });
  assert.equal(container.querySelector("#cell-A1").textContent, "OBRA SUL");
  assert.equal(container.querySelector("#cell-B1").textContent, "preservar");
  await act(async () => { findByText(container, /^Desfazer$/, "button").click(); });
  assert.equal(container.querySelector("#cell-A1").textContent, "  obra   sul  ");
  await act(async () => { findByText(container, /^Refazer$/, "button").click(); });
  assert.equal(container.querySelector("#cell-A1").textContent, "OBRA SUL");
});

test("colar tabela expande grade, recalcula e desfaz em uma operação", async () => {
  await openWorksheet();
  const paste = new window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", { value: { getData: () => "10\t20\n30\t=SOMA(A1:B1)" } });
  await act(async () => { container.querySelector("#cell-A1").dispatchEvent(paste); });
  assert.equal(paste.defaultPrevented, true);
  assert.equal(container.querySelector("#cell-B2").textContent, "30");
  await act(async () => { findByText(container, /^Desfazer$/, "button").click(); });
  assert.equal(container.querySelector("#cell-A1").textContent, "");
  assert.equal(container.querySelector("#cell-B2").textContent, "");
});

test("formatação acompanha inserção de coluna e aparece no valor exibido", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { B1: "1250" }, formats: { B: "moeda" }, bold: ["B1"], widths: { B: 220 } } });
  assert.match(container.querySelector("#cell-B1").textContent, /1.250,00/);
  await act(async () => { findByText(container, /Inserir coluna/, "button").click(); });
  assert.match(container.querySelector("#cell-C1").textContent, /R\$/);
  assert.equal(container.querySelector("#cell-C1").parentElement.style.fontWeight, "700");
  assert.equal(container.querySelector("#cell-C1").parentElement.style.minWidth, "220px");
  await act(async () => { findByText(container, /^Desfazer$/, "button").click(); });
  assert.match(container.querySelector("#cell-B1").textContent, /R\$/);
  assert.equal(container.querySelector("#cell-B1").parentElement.style.fontWeight, "700");
  assert.equal(container.querySelector("#cell-B1").parentElement.style.minWidth, "220px");
});

function worksheet(overrides = {}) {
  return {
    id: "w1", kind: "sheet", name: "Teste", columns: 3, rows: 3,
    createdByName: "Contratante", revision: 1, updatedAt: Date.now(), visibility: "organization",
    content: {
      cells: {}, body: "", widths: {}, formats: {}, bold: [],
      analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [] },
    },
    ...overrides,
  };
}

async function openWorksheet(overrides = {}, extraRoutes = {}) {
  const current = worksheet(overrides);
  const summary = { ...current }; delete summary.content;
  const calls = stubFetch({
    "/api/worksheets/data": { sources: [] },
    "/api/worksheets": { worksheets: [summary], canGovern: false },
    "/api/worksheets/w1": { worksheet: current, access: { canView: true, canEdit: true, canGovern: false, level: "empresa" } },
    ...extraRoutes,
  });
  await act(async () => { reactRoot.render(React.createElement(WorksheetsWorkspace, { query: "" })); });
  await settle();
  return calls;
}

test("regras salvas colorem células, mostram opções e bloqueiam salvamento inválido", async () => {
  const content = { ...worksheet().content, cells: { A1: "Fora", B1: "=2+3" }, advanced: {
    validations: [{ range: "A1", kind: "list", options: ["Sim", "Não"], allowBlank: false }],
    conditions: [{ range: "B1", kind: "greater", value: "4", color: "green" }], views: [],
  } };
  const calls = await openWorksheet({ content });
  assert.match(textOf(container), /1 célula\(s\) inválida/);
  assert.equal(container.querySelector("#cell-B1").parentElement.style.backgroundColor, "rgb(220, 252, 231)");
  assert.ok(container.querySelector('[aria-label="Opções para A1"]'));
  await act(async () => { findByText(container, /Salvar/, "button").click(); });
  assert.equal(calls.some(call => call.method === "PATCH"), false);
  const options = container.querySelector('[aria-label="Opções para A1"]');
  await act(async () => { options.value = "Sim"; options.dispatchEvent(new window.Event("change", { bubbles: true })); });
  assert.equal(container.querySelector("#cell-A1").textContent, "Sim");
  assert.doesNotMatch(textOf(container), /1 célula\(s\) inválida/);
  await act(async () => { findByText(container, /Salvar/, "button").click(); });
  assert.equal(calls.find(call => call.method === "PATCH").body.content.advanced.validations[0].kind, "list");
});

test("resumo reage aos dados e configurações participam do desfazer", async () => {
  const content = { ...worksheet().content, cells: { A1: "Setor", B1: "Custo", A2: "Obra", B2: "-20", A3: "Obra", B3: "30" }, advanced: { validations: [], conditions: [], views: [{ name: "Custo por setor", range: "A1:B3", groupColumn: 0, valueColumn: 1, aggregation: "sum", chart: "bar" }] } };
  await openWorksheet({ content });
  const chart = container.querySelector('svg[role="img"]'); assert.ok(chart);
  assert.match(chart.textContent, /Obra: 10/);
  await act(async () => { container.querySelector('[aria-label="Excluir resumo Custo por setor"]').click(); });
  assert.equal(container.querySelector('svg[role="img"]'), null);
  await act(async () => { container.querySelector('[aria-label^="Desfazer"]').click(); });
  assert.ok(container.querySelector('svg[role="img"]'));
});

test("acesso de leitura mostra resumos sem expor edição nem importação XLSX", async () => {
  const current = worksheet({ content: { ...worksheet().content, cells: { A1: "Setor", B1: "Custo", A2: "Obra", B2: "5" }, advanced: { validations: [], conditions: [], views: [{ name: "Custo", range: "A1:B2", groupColumn: 0, valueColumn: 1, aggregation: "sum", chart: "table" }] } } });
  await openWorksheet(current, { "/api/worksheets/w1": { worksheet: current, access: { canView: true, canEdit: false, canGovern: false, level: "view" } } });
  assert.match(textOf(container), /Custo/);
  assert.equal(container.querySelector('[aria-label="Importar arquivo XLSX"]'), null);
  assert.equal(container.querySelector('[aria-label="Tipo de validação"]'), null);
  assert.equal(container.querySelector('[aria-label="Excluir resumo Custo"]'), null);
  assert.ok(findByText(container, /Baixar XLSX salvo/, "button"));
});

test("uma tecla inicia a edição uma única vez", async () => {
  await openWorksheet();
  const cell = container.querySelector("#cell-A1");
  assert.ok(cell, "A1 deve estar na grade");

  let event;
  await act(async () => {
    cell.focus();
    event = new window.KeyboardEvent("keydown", { key: "7", bubbles: true, cancelable: true });
    cell.dispatchEvent(event);
  });

  assert.equal(event.defaultPrevented, true, "a tecla original precisa ser consumida pela célula");
  const editor = container.querySelector('input[aria-label="Célula A1"]');
  assert.ok(editor, "digitar abre o editor da célula");
  assert.equal(editor.value, "7", "a primeira tecla aparece uma vez, nunca 77");
});

test("remover linha e coluna reduz a grade e mantém uma célula ativa válida", async () => {
  await openWorksheet({ content: {
    cells: { A1: "1", B2: "2", C3: "3" }, body: "", widths: {}, formats: {}, bold: [],
    analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [] },
  } });
  assert.equal(container.querySelectorAll("tbody tr").length, 3);
  assert.equal(container.querySelectorAll("thead th").length, 4, "# mais três colunas");

  await act(async () => { findByText(container, /Remover linha/)?.click(); });
  assert.equal(container.querySelectorAll("tbody tr").length, 2, "a dimensão de linhas também diminui");

  await act(async () => { findByText(container, /Remover coluna/)?.click(); });
  assert.equal(container.querySelectorAll("thead th").length, 3, "# mais duas colunas após remover");
  assert.ok(container.querySelector("#cell-A1"), "a seleção permanece dentro da grade");
});

test("quem edita mas não pode excluir não vê o botão de excluir", async () => {
  // O servidor exige canDelete e responde 403. Mostrar o botão mesmo assim fazia o
  // colaborador clicar e nada acontecer — o "excluir não responde" relatado pelo titular.
  // O teste anterior afirmava o contrário e consolidava o defeito.
  const current = worksheet();
  const summary = { ...current }; delete summary.content;
  stubFetch({
    "/api/worksheets/data": { sources: [] },
    "/api/worksheets": () => ({ worksheets: [summary], canGovern: false }),
    "/api/worksheets/w1": () => ({ worksheet: current, access: { canView: true, canEdit: true, canGovern: false, canDelete: false, level: "edit" } }),
  });
  await act(async () => { reactRoot.render(React.createElement(WorksheetsWorkspace, { query: "" })); });
  await settle();

  assert.equal(container.querySelector('[aria-label="Excluir"]'), null,
    "sem canDelete o botão não pode aparecer");
  assert.match(textOf(container), /Salvar/, "mas continua podendo editar e salvar");
});

test("excluir planilha chama DELETE, remove a peça da tela e dá caminho para criar outra", async () => {
  let exists = true;
  const current = worksheet();
  const summary = { ...current }; delete summary.content;
  const previousConfirm = window.confirm;
  window.confirm = () => true;
  try {
    const calls = stubFetch({
      "/api/worksheets/data": { sources: [] },
      "/api/worksheets": () => ({ worksheets: exists ? [summary] : [], canGovern: false }),
      "/api/worksheets/w1": ({ method }) => {
        if (method === "DELETE") { exists = false; return { deleted: true }; }
        return { worksheet: current, access: { canView: true, canEdit: true, canGovern: false, canDelete: true, level: "empresa" } };
      },
    });
    await act(async () => { reactRoot.render(React.createElement(WorksheetsWorkspace, { query: "" })); });
    await settle();

    const button = container.querySelector('[aria-label="Excluir"]');
    assert.ok(button, "quem pode excluir vê o botão");
    await act(async () => { button.click(); });
    await settle();

    assert.ok(calls.some((call) => call.path === "/api/worksheets/w1" && call.method === "DELETE"), "a exclusão chega ao servidor");
    assert.equal(exists, false);
    assert.match(textOf(container), /Comece por um modelo/, "depois de excluir não fica uma planilha fantasma aberta");
  } finally {
    window.confirm = previousConfirm;
  }
});

// Seleção por eixo. A planilha somava coluna certo e não tinha caminho nenhum
// para a linha: o cabeçalho não era clicável e o rodapé filtrava sempre pela
// coluna do cursor. Quem fecha um mês lendo a linha via o total de outra conta.
const comDados = { columns: 4, rows: 4, content: {
  cells: { A1: "10", B1: "20", C1: "30", A2: "5", A3: "5" }, body: "", widths: {}, formats: {}, bold: [],
  analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [] },
} };

async function clickCell(key, modifiers = {}) {
  const cell = container.querySelector(`#cell-${key}`);
  // Reproduz a ordem do navegador: mousedown, foco, mouseup, click.
  await act(async () => {
    cell.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, ...modifiers }));
    cell.focus();
  });
  await act(async () => {
    cell.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, ...modifiers }));
    cell.dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...modifiers }));
  });
}

test("Ctrl mantém células separadas e soma apenas a seleção, sem duplicar parcelas", async () => {
  await openWorksheet(comDados);
  await clickCell("A1");
  await clickCell("C1", { ctrlKey: true });
  assert.equal(container.querySelector("#cell-A1").getAttribute("aria-pressed"), "true");
  assert.equal(container.querySelector("#cell-C1").getAttribute("aria-pressed"), "true");
  assert.match(textOf(container), /Preenchidas\s*2/);
  assert.match(textOf(container), /Soma\s*40/);
  await clickCell("A2", { metaKey: true });
  assert.match(textOf(container), /Preenchidas\s*3/);
  assert.match(textOf(container), /Soma\s*45/);
  await clickCell("C1", { ctrlKey: true });
  assert.equal(container.querySelector("#cell-C1").getAttribute("aria-pressed"), "false");
  assert.match(textOf(container), /Preenchidas\s*2/);
  assert.match(textOf(container), /Soma\s*15/);
  await clickCell("B1");
  assert.equal(container.querySelector("#cell-A1").getAttribute("aria-pressed"), "false");
  assert.equal(container.querySelector("#cell-B1").getAttribute("aria-pressed"), "true");
});

test("SOMA da seleção preserva parcelas e grava fórmula numa célula livre", async () => {
  await openWorksheet({ ...comDados, content: { ...comDados.content,
    cells: { A1: "1.234,56", B1: "ignorar", C1: "R$ 765,44", C2: "ocupada" },
  } });
  await clickCell("A1");
  await clickCell("C1", { ctrlKey: true });
  assert.match(textOf(container), /Soma\s*2\.000/);
  await act(async () => {
    const functions = container.querySelector('[aria-label="Inserir função"]');
    functions.value = "SOMA";
    functions.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(container.querySelector('[aria-label="Conteúdo da célula"]').value, "=SOMA(A1;C1)");
  assert.equal(container.querySelector("#cell-C3").textContent, "2.000");
  assert.equal(container.querySelector("#cell-C2").textContent, "ocupada");
  assert.equal(container.querySelector("#cell-A1").textContent, "1.234,56");
  assert.equal(container.querySelector("#cell-C1").textContent, "765,44");
});

test("clicar no cabeçalho seleciona a linha e soma a linha, não a coluna", async () => {
  await openWorksheet(comDados);

  const cabecalho = container.querySelector('[aria-label="Selecionar linha 1"]');
  assert.ok(cabecalho, "o cabeçalho da linha precisa ser selecionável");

  await act(async () => { cabecalho.click(); });
  assert.equal(cabecalho.getAttribute("aria-pressed"), "true", "a linha selecionada se anuncia como tal");

  const texto = textOf(container);
  assert.match(texto, /Linha 1/, "a barra passa a falar da linha escolhida");
  assert.match(texto, /Total\s*60/, "10 + 20 + 30 da linha, não os 20 da coluna A");
  // A mesma marcação feita arrastando responderia média e extremos; pelo cabeçalho
  // também responde, senão clicar no cabeçalho seria a forma pior de marcar.
  assert.match(texto, /Média\s*20/);
  assert.match(texto, /Mín\s*10/);
  assert.match(texto, /Máx\s*30/);
});

test("a função inserida na linha selecionada gera intervalo horizontal", async () => {
  await openWorksheet(comDados);

  await act(async () => { container.querySelector('[aria-label="Selecionar linha 1"]').click(); });
  // O cursor para na primeira célula livre da linha, que é onde o total entra.
  assert.equal(container.querySelector('[aria-label="Conteúdo da célula"]').value, "",
    "D1 está livre e recebe o total");

  const funcoes = container.querySelector('[aria-label="Inserir função"]');
  await act(async () => {
    funcoes.value = "SOMA";
    funcoes.dispatchEvent(new window.Event("change", { bubbles: true }));
  });

  assert.equal(container.querySelector('[aria-label="Conteúdo da célula"]').value, "=SOMA(A1:C1)",
    "o intervalo anda na linha; antes os dois extremos usavam a mesma coluna");
});

test("sem eixo escolhido o total continua sendo o da coluna do cursor", async () => {
  await openWorksheet(comDados);
  // Uma célula marcada: a barra mostra o TOTAL DA COLUNA, e não repete o valor da
  // célula, que a barra de fórmulas logo acima já exibe.
  const inicial = textOf(container);
  assert.match(inicial, /Total da coluna A\s*20/, "A1 + A2 + A3 = 20, o comportamento que já existia");
  assert.doesNotMatch(inicial, /Soma\s/, "com uma célula só não há soma de seleção a mostrar");

  await act(async () => { container.querySelector('[aria-label="Selecionar coluna B"]').click(); });
  assert.match(textOf(container), /Total\s*20/, "a coluna B tem só o 20 de B1");
});

/**
 * Seleção por arrasto e a barra de resumo.
 *
 * O rodapé antigo respondia uma pergunta só — a soma — e, depois de qualquer clique,
 * respondia mal: "Soma da seleção (1 células)", plural errado, valor que a barra de
 * fórmulas já mostrava, e que derrubava o total da coluna. E não havia como marcar
 * "da linha 2 até a 31" sem trinta Ctrl + cliques.
 */

async function arrastar(de, ate) {
  const inicio = container.querySelector(`#cell-${de}`);
  await act(async () => {
    inicio.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", buttons: 1 }));
  });
  for (const chave of ate) {
    const alvo = container.querySelector(`#cell-${chave}`);
    await act(async () => {
      alvo.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", buttons: 1 }));
    });
  }
  await act(async () => { window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true })); });
}

test("arrastar marca o retângulo e a barra responde as cinco perguntas", async () => {
  await openWorksheet(comDados);
  // Clicar em OUTRA célula antes é de propósito: a âncora tem que nascer onde o arrasto
  // começa, não na seleção anterior. Com o clique na própria A1 este teste passava mesmo
  // com a âncora vindo do lugar errado — que foi exatamente o defeito relatado.
  await clickCell("C1");
  await arrastar("A1", ["A2", "A3"]);

  const texto = textOf(container);
  assert.match(texto, /A1:A3/, "o intervalo aparece, para confirmar o que foi marcado");
  assert.match(texto, /Preenchidas\s*3/);
  assert.match(texto, /Soma\s*20/);
  assert.match(texto, /Média\s*6,67/, "a média é arredondada na exibição, não no valor");
  assert.match(texto, /Mín\s*5/);
  assert.match(texto, /Máx\s*10/);
});

test("arrastar no toque não marca: no celular o arrasto rola a grade", async () => {
  await openWorksheet(comDados);
  await clickCell("A1");
  const alvo = container.querySelector("#cell-A3");
  await act(async () => {
    container.querySelector("#cell-A1").dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", buttons: 1 }));
    alvo.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true, pointerType: "touch", buttons: 1 }));
  });
  assert.equal(container.querySelector("#cell-A3").getAttribute("aria-pressed"), "false");
});

test("soltar o botão encerra o arrasto: passar o mouse depois não marca mais", async () => {
  await openWorksheet(comDados);
  await clickCell("A1");
  await arrastar("A1", ["A2"]);
  await act(async () => {
    container.querySelector("#cell-A3").dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", buttons: 0 }));
  });
  assert.equal(container.querySelector("#cell-A3").getAttribute("aria-pressed"), "false");
});

test("Shift + clique estende a partir da âncora, sem apagá-la", async () => {
  await openWorksheet(comDados);
  await clickCell("A1");
  await clickCell("A3", { shiftKey: true });

  assert.equal(container.querySelector("#cell-A1").getAttribute("aria-pressed"), "true");
  assert.equal(container.querySelector("#cell-A2").getAttribute("aria-pressed"), "true");
  assert.equal(container.querySelector("#cell-A3").getAttribute("aria-pressed"), "true");
  assert.match(textOf(container), /A1:A3/);
});

test("seleção só de texto não exibe Soma 0", async () => {
  // Zero é um número que a tela exibe sem ninguém desconfiar. Dizer que não há número
  // para somar é a resposta honesta.
  await openWorksheet({ ...comDados, content: { ...comDados.content, cells: { A1: "alvenaria", A2: "pintura" } } });
  await clickCell("A1");
  await arrastar("A1", ["A2"]);

  const texto = textOf(container);
  assert.match(texto, /sem número para somar/);
  assert.doesNotMatch(texto, /Soma\s*0/);
});

test("célula com erro é contada à parte e fica fora da soma", async () => {
  await openWorksheet({ ...comDados, content: { ...comDados.content, cells: { A1: "10", A2: "=1/0" } } });
  await clickCell("A1");
  await arrastar("A1", ["A2"]);

  const texto = textOf(container);
  assert.match(texto, /1 com erro, fora das contas/);
  assert.match(texto, /Soma\s*10/, "o erro não entra como zero na conta");
});

/**
 * Desfazer, refazer e colar.
 *
 * Até aqui a planilha só tinha o estado atual: remover a coluna errada ou errar o
 * preenchimento para baixo era perda definitiva, e a pessoa só descobria depois de
 * salvar. E colar um bloco do Excel simplesmente não existia — o orçamento vinha de lá
 * e tinha que ser redigitado célula por célula.
 */

function apertar(elemento, key, modifiers = {}) {
  return act(async () => {
    elemento.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key, ...modifiers }));
  });
}

function colarNaGrade(texto) {
  // Pelo contêiner, não por uma célula: com o editor aberto a célula vira input e o
  // `#cell-A1` deixa de existir — que é justamente um dos casos testados.
  const grade = container.querySelector("div.select-none");
  const evento = new window.Event("paste", { bubbles: true, cancelable: true });
  evento.clipboardData = { getData: () => texto };
  return act(async () => { grade.dispatchEvent(evento); });
}

test("colar valor decimal e fórmula mantém uma célula e não adivinha separadores CSV", async () => {
  await openWorksheet(comDados); await clickCell("A1");
  await colarNaGrade("12,50");
  assert.equal(container.querySelector("#cell-A1").textContent.trim(), "12,5");
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "20");
  await colarNaGrade("=SOMA(B1;C1)");
  assert.equal(container.querySelector("#cell-A1").textContent.trim(), "50");
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "20");
});

test("colar conteúdo acima do limite não escreve um bloco parcial", async () => {
  await openWorksheet(comDados); await clickCell("A1");
  await colarNaGrade(`Substituição\t${"x".repeat(2001)}`);
  assert.equal(container.querySelector("#cell-A1").textContent.trim(), "10");
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "20");
  assert.equal(findByText(container, /Desfazer/).disabled, true);
});

test("desfazer devolve a coluna excluída — e a grade volta a caber nela", async () => {
  // O defeito que isto tranca: um histórico só de células devolveria B1 numa grade que
  // continua com três colunas. A coluna volta e não aparece.
  await openWorksheet(comDados);
  await clickCell("B1");

  await act(async () => { findByText(container, /Remover coluna/).click(); });
  assert.equal(container.querySelector("#cell-D1"), null, "a grade encolheu");
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "30", "C tomou o lugar de B");

  await act(async () => { findByText(container, /Desfazer/).click(); });
  assert.ok(container.querySelector("#cell-D1"), "a quarta coluna voltou a existir");
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "20", "e o conteúdo voltou para o lugar");
  assert.equal(container.querySelector("#cell-C1").textContent.trim(), "30");
});

test("o botão diz o que vai desfazer, sem obrigar a clicar para descobrir", async () => {
  await openWorksheet(comDados);
  await clickCell("B1");
  await act(async () => { findByText(container, /Remover coluna/).click(); });

  assert.match(findByText(container, /Desfazer/).getAttribute("title"), /Desfazer excluir coluna B/);
});

test("com a planilha recém-aberta não há o que desfazer", async () => {
  // Botão aceso prometendo uma ação que não acontece é pior do que botão apagado.
  await openWorksheet(comDados);
  assert.equal(findByText(container, /Desfazer/).disabled, true);
  assert.equal(findByText(container, /Refazer/).disabled, true);
});

test("Ctrl+Z na grade desfaz, e Ctrl+Shift+Z refaz", async () => {
  await openWorksheet(comDados);
  await clickCell("B1");
  await act(async () => { findByText(container, /Remover coluna/).click(); });

  await apertar(container.querySelector("#cell-A1"), "z", { ctrlKey: true });
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "20", "Ctrl+Z desfez");

  await apertar(container.querySelector("#cell-A1"), "z", { ctrlKey: true, shiftKey: true });
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "30", "Ctrl+Shift+Z refez");
});

test("colar do Excel faz a grade crescer em vez de cortar o que foi colado", async () => {
  // Truncar em silêncio um bloco de trinta linhas numa planilha de quatro seria perder
  // vinte e seis linhas de orçamento sem ninguém ver.
  await openWorksheet(comDados);
  await clickCell("A1");
  await colarNaGrade("Etapa\tCusto\nAlvenaria\t1200\nPintura\t800\nEsquadria\t950\nLouças\t400");

  assert.ok(container.querySelector("#cell-A5"), "a grade cresceu para caber as cinco linhas");
  assert.equal(container.querySelector("#cell-A1").textContent.trim(), "Etapa");
  assert.equal(container.querySelector("#cell-B4").textContent.trim(), "950");
});

test("a colagem entra como um passo só do histórico", async () => {
  await openWorksheet(comDados);
  await clickCell("A1");
  await colarNaGrade("Etapa\tCusto\nAlvenaria\t1200");

  assert.match(findByText(container, /Desfazer/).getAttribute("title"), /Desfazer colar 2 linhas × 2 colunas/);

  await act(async () => { findByText(container, /Desfazer/).click(); });
  assert.equal(container.querySelector("#cell-A1").textContent.trim(), "10", "um clique devolve a planilha inteira");
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "20");
});

test("colar dentro da célula em edição continua sendo colar texto", async () => {
  // Quem está digitando uma fórmula e cola um trecho espera o texto no campo, não a
  // planilha reescrita a partir dali.
  await openWorksheet(comDados);
  await clickCell("A1");
  await apertar(container.querySelector("#cell-A1"), "F2");
  await colarNaGrade("Etapa\tCusto\nAlvenaria\t1200");
  await apertar(container.querySelector("input[aria-label='Célula A1']"), "Escape");

  assert.equal(container.querySelector("#cell-A1").textContent.trim(), "10", "a planilha não foi reescrita a partir de A1");
  assert.equal(container.querySelector("#cell-B1").textContent.trim(), "20");
  assert.equal(findByText(container, /Desfazer/).disabled, true, "e nada entrou no histórico");
});

function escolher(select, valor) {
  return act(async () => { select.value = valor; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
}

function digitarNaBarra(texto) {
  const barra = container.querySelector('[aria-label="Conteúdo da célula"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  return act(async () => { setter.call(barra, texto); barra.dispatchEvent(new window.Event("input", { bubbles: true })); });
}

test("preencher para baixo com um retângulo marcado preenche cada coluna dele", async () => {
  // Antes só a coluna do cursor recebia; B e C ficavam como estavam, sem aviso.
  await openWorksheet({ rows: 5, content: { ...worksheet().content, cells: { A1: "=10", B1: "=A1*2", C1: "=B1+1" } } });
  await clickCell("A1");
  await clickCell("C4", { shiftKey: true });
  await act(async () => { findByText(container, /Preencher para baixo/, "button").click(); });
  assert.equal(container.querySelector("#cell-A4").textContent, "10");
  assert.equal(container.querySelector("#cell-B4").textContent, "20", "a coluna B também foi preenchida, com a referência deslocada");
  assert.equal(container.querySelector("#cell-C4").textContent, "21");
  assert.equal(container.querySelector("#cell-A5").textContent, "", "o preenchimento para no fim do intervalo");
});

test("ordenar funciona na planilha criada por modelo, com fórmula em toda linha", async () => {
  const cells = {
    A1: "Item", B1: "Qtd", C1: "Unit", D1: "Total",
    A2: "Cimento", B2: "10", C2: "40", D2: '=SE(B2="";"";B2*C2)',
    A3: "Areia", B3: "3", C3: "100", D3: '=SE(B3="";"";B3*C3)',
    A4: "Total", D4: "=SOMA(D2:D3)",
  };
  await openWorksheet({ columns: 4, rows: 6, content: { ...worksheet().content, cells, analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [3] } } });
  await clickCell("A2");
  await act(async () => { findByText(container, /Ordenar ↑/, "button").click(); });
  assert.equal(container.querySelector("#cell-A2").textContent, "Areia");
  assert.equal(container.querySelector("#cell-D2").textContent, "300", "a fórmula acompanhou a linha");
  assert.equal(container.querySelector("#cell-A4").textContent, "Total", "a linha de total ficou no lugar");
  assert.equal(container.querySelector("#cell-D4").textContent, "700");
});

test("a largura da coluna ajusta pelo teclado, entra no desfazer e marca como não salvo", async () => {
  await openWorksheet();
  const borda = container.querySelector('[role="separator"][aria-label="Largura da coluna A"]');
  assert.ok(borda, "a borda de ajuste existe e tem nome acessível");
  await apertar(borda, "ArrowRight");
  const cabecalho = borda.closest("th");
  assert.equal(cabecalho.style.width, "130px");
  assert.equal(container.querySelector("#cell-A1").parentElement.style.width, "130px", "as células acompanham");
  assert.match(textOf(container), /Não salvo/);
  await act(async () => { findByText(container, /^Desfazer$/, "button").click(); });
  assert.equal(cabecalho.style.width, "120px");
});

test("fixar colunas deixa a coluna A parada ao rolar para o lado", async () => {
  await openWorksheet();
  assert.notEqual(container.querySelector("#cell-A1").parentElement.style.position, "sticky");
  await escolher(container.querySelector('[aria-label="Colunas fixas ao rolar"]'), "1");
  const celula = container.querySelector("#cell-A1").parentElement;
  assert.equal(celula.style.position, "sticky");
  assert.equal(celula.style.left, "48px", "logo depois da guia de números");
  assert.notEqual(container.querySelector("#cell-B1").parentElement.style.position, "sticky");
});

test("a barra de fórmula sugere funções e Tab completa a primeira", async () => {
  await openWorksheet();
  await clickCell("A1");
  await digitarNaBarra("=SO");
  const grupo = container.querySelector('[aria-label="Funções que completam o que você digitou"]');
  assert.ok(grupo);
  assert.match(textOf(grupo), /SOMA/);
  assert.match(textOf(grupo), /SOMASE/);
  await apertar(container.querySelector('[aria-label="Conteúdo da célula"]'), "Tab");
  assert.equal(container.querySelector('[aria-label="Conteúdo da célula"]').value, "=SOMA(");
  assert.equal(container.querySelector('[aria-label="Funções que completam o que você digitou"]'), null);
});

test("formato contábil mostra o negativo entre parênteses e em vermelho", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "-250" }, formats: { A: "contabil" } } });
  const celula = container.querySelector("#cell-A1");
  assert.match(celula.textContent, /\(R\$\s250,00\)/);
  assert.match(celula.className, /text-red-700/);
});

test("imprimir monta a tabela com texto, nunca com marcação", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "<img src=x onerror=alert(1)>", B1: "=2*3" } } });
  // O jsdom não imprime: troca o print do iframe recém-criado por um que guarda o documento.
  let impresso = null;
  const append = document.body.append.bind(document.body);
  document.body.append = (...nodes) => {
    append(...nodes);
    for (const frame of nodes.filter((node) => node.tagName === "IFRAME")) frame.contentWindow.print = () => { impresso = frame.contentDocument; };
  };
  try {
    await act(async () => { findByText(container, /Imprimir ou PDF/, "button").click(); });
  } finally { document.body.append = append; }
  assert.ok(impresso, "a janela de impressão foi chamada");
  assert.equal(impresso.querySelector("img"), null, "o conteúdo da célula não virou HTML");
  assert.match(impresso.body.textContent, /<img src=x/);
  assert.match(impresso.body.textContent, /Teste/);
  assert.equal(impresso.querySelectorAll("tbody td")[1].textContent, "6");
});

// ─── Formatação de texto ───

const barraDeFormatacao = () => container.querySelector('[role="toolbar"][aria-label="Formatação do texto"]');
const botaoDaBarra = (nome) => barraDeFormatacao().querySelector(`[aria-label="${nome}"]`);

test("negrito, itálico, sublinhado e tachado pela barra, com estado e desfazer", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Etapa", B1: "Custo" } } });
  await clickCell("A1");
  await clickCell("B1", { shiftKey: true });
  await act(async () => { botaoDaBarra("Itálico (Ctrl+I)").click(); });
  assert.equal(container.querySelector("#cell-A1").style.fontStyle, "italic");
  assert.equal(container.querySelector("#cell-B1").style.fontStyle, "italic", "vale para toda a seleção");
  assert.equal(botaoDaBarra("Itálico (Ctrl+I)").getAttribute("aria-pressed"), "true", "o botão mostra que está ligado");
  await act(async () => { botaoDaBarra("Negrito (Ctrl+B)").click(); });
  assert.equal(container.querySelector("#cell-A1").parentElement.style.fontWeight, "700");
  await act(async () => { botaoDaBarra("Sublinhado (Ctrl+U)").click(); });
  await act(async () => { botaoDaBarra("Tachado").click(); });
  assert.equal(container.querySelector("#cell-B1").style.textDecorationLine, "underline line-through");
  await act(async () => { findByText(container, /^Desfazer$/, "button").click(); });
  assert.equal(container.querySelector("#cell-B1").style.textDecorationLine, "underline");
  assert.match(textOf(container), /Não salvo/);
});

test("Ctrl+B, Ctrl+I e Ctrl+U funcionam na grade", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Etapa" } } });
  await clickCell("A1");
  await apertar(container.querySelector("#cell-A1"), "i", { ctrlKey: true });
  await apertar(container.querySelector("#cell-A1"), "u", { ctrlKey: true });
  await apertar(container.querySelector("#cell-A1"), "b", { ctrlKey: true });
  const celula = container.querySelector("#cell-A1");
  assert.equal(celula.style.fontStyle, "italic");
  assert.equal(celula.style.textDecorationLine, "underline");
  assert.equal(celula.parentElement.style.fontWeight, "700");
  assert.equal(container.querySelector('input[aria-label="Célula A1"]'), null, "a tecla não abriu o editor");
});

test("alinhar ao centro e à direita, e voltar ao automático", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Etapa" } } });
  await clickCell("A1");
  await act(async () => { botaoDaBarra("Centralizar").click(); });
  assert.equal(container.querySelector("#cell-A1").style.textAlign, "center");
  await act(async () => { botaoDaBarra("Alinhar à direita").click(); });
  assert.equal(container.querySelector("#cell-A1").style.textAlign, "right");
  await act(async () => { botaoDaBarra("Alinhar à direita").click(); });
  assert.equal(container.querySelector("#cell-A1").style.textAlign, "", "clicar de novo volta ao alinhamento automático");
});

test("cor do texto, preenchimento, quebra de texto e limpar formatação", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Etapa longa de fundação" } } });
  await clickCell("A1");
  await escolher(container.querySelector('[aria-label="Cor do texto"]'), "red");
  await escolher(container.querySelector('[aria-label="Cor de preenchimento"]'), "yellow");
  await act(async () => { botaoDaBarra("Quebrar texto na célula").click(); });
  const celula = container.querySelector("#cell-A1");
  assert.equal(celula.style.color, "rgb(185, 28, 28)");
  assert.equal(celula.parentElement.style.backgroundColor, "rgb(254, 249, 195)");
  assert.equal(celula.style.whiteSpace, "pre-wrap");
  assert.doesNotMatch(celula.className, /truncate/, "texto quebrado não é cortado");
  await act(async () => { findByText(barraDeFormatacao(), /Limpar formatação/, "button").click(); });
  assert.equal(container.querySelector("#cell-A1").style.color, "");
  assert.equal(container.querySelector("#cell-A1").parentElement.style.backgroundColor, "");
});

test("mesclar pede confirmação, junta o retângulo, centraliza e desfaz", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Orçamento", B1: "rascunho" } } });
  await clickCell("A1");
  await clickCell("C1", { shiftKey: true });
  const confirmar = window.confirm;
  let pergunta = "";
  window.confirm = (texto) => { pergunta = texto; return true; };
  try { await act(async () => { findByText(barraDeFormatacao(), /^Mesclar$/, "button").click(); }); }
  finally { window.confirm = confirmar; }
  assert.match(pergunta, /apaga 1 célula\(s\): B1/, "avisa o que vai sumir");
  const ancora = container.querySelector("#cell-A1").parentElement;
  assert.equal(ancora.colSpan, 3);
  assert.equal(container.querySelector("#cell-B1"), null, "as células cobertas não aparecem");
  assert.equal(container.querySelector("#cell-A1").style.textAlign, "center");
  assert.equal(ancora.style.width, "360px", "a largura é a soma das três colunas");

  await clickCell("A1");
  await act(async () => { findByText(barraDeFormatacao(), /Desfazer mesclagem/, "button").click(); });
  assert.ok(container.querySelector("#cell-B1"));
  assert.equal(container.querySelector("#cell-B1").textContent, "", "o conteúdo apagado não volta ao desmesclar");
  await act(async () => { findByText(container, /^Desfazer$/, "button").click(); });
  await act(async () => { findByText(container, /^Desfazer$/, "button").click(); });
  assert.equal(container.querySelector("#cell-B1").textContent, "rascunho", "o desfazer traz o conteúdo de volta");
});

test("recusar a confirmação não mescla nada", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Orçamento", B1: "importante" } } });
  await clickCell("A1");
  await clickCell("B1", { shiftKey: true });
  const confirmar = window.confirm;
  window.confirm = () => false;
  try { await act(async () => { findByText(barraDeFormatacao(), /^Mesclar$/, "button").click(); }); }
  finally { window.confirm = confirmar; }
  assert.equal(container.querySelector("#cell-B1").textContent, "importante");
  assert.equal(container.querySelector("#cell-A1").parentElement.colSpan, 1);
});

test("setas atravessam a mesclagem pela borda e param na âncora", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Título" }, merges: ["A1:B2"] } });
  await clickCell("A1");
  await apertar(container.querySelector("#cell-A1"), "ArrowRight");
  assert.equal(document.activeElement.id, "cell-C1", "da âncora, a direita sai depois de B");
  await apertar(container.querySelector("#cell-C1"), "ArrowLeft");
  assert.equal(document.activeElement.id, "cell-A1", "entrar no bloco cai na âncora");
  await apertar(container.querySelector("#cell-A1"), "ArrowDown");
  assert.equal(document.activeElement.id, "cell-A3");
});

test("inserir linha acima leva estilo e mesclagem junto", async () => {
  await openWorksheet({ rows: 4, content: { ...worksheet().content, cells: { A2: "Título" }, styles: { A2: { italic: true } }, merges: ["A2:B2"] } });
  await clickCell("A1");
  await act(async () => { findByText(container, /Inserir linha/, "button").click(); });
  const celula = container.querySelector("#cell-A3");
  assert.equal(celula.textContent, "Título");
  assert.equal(celula.style.fontStyle, "italic");
  assert.equal(celula.parentElement.colSpan, 2);
});

test("ordenar leva o negrito e o estilo com a linha", async () => {
  await openWorksheet({ rows: 4, content: { ...worksheet().content,
    cells: { A1: "Item", A2: "Cimento", A3: "Areia" }, bold: ["A2"], styles: { A2: { fill: "yellow" } } } });
  await clickCell("A2");
  await act(async () => { findByText(container, /Ordenar ↑/, "button").click(); });
  assert.equal(container.querySelector("#cell-A3").textContent, "Cimento");
  assert.equal(container.querySelector("#cell-A3").parentElement.style.fontWeight, "700", "o negrito foi com o Cimento");
  assert.equal(container.querySelector("#cell-A2").parentElement.style.fontWeight, "", "e não ficou na Areia");
  assert.equal(container.querySelector("#cell-A3").parentElement.style.backgroundColor, "rgb(254, 249, 195)");
});

test("somente leitura não mostra a barra de formatação", async () => {
  const current = worksheet({ content: { ...worksheet().content, cells: { A1: "x" }, styles: { A1: { italic: true } } } });
  const summary = { ...current }; delete summary.content;
  stubFetch({
    "/api/worksheets/data": { sources: [] },
    "/api/worksheets": { worksheets: [summary], canGovern: false },
    "/api/worksheets/w1": { worksheet: current, access: { canView: true, canEdit: false, canGovern: false, level: "view" } },
  });
  await act(async () => { reactRoot.render(React.createElement(WorksheetsWorkspace, { query: "" })); });
  await settle();
  assert.equal(barraDeFormatacao(), null);
  assert.equal(container.querySelector("#cell-A1").style.fontStyle, "italic", "mas a formatação aparece");
});

// ─── Menu do botão direito ───

async function botaoDireito(elemento) {
  await act(async () => {
    elemento.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
  });
  await settle();
  return document.querySelector('[role="menu"]');
}
async function escolherNoMenu(texto) {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) => texto.test(node.textContent ?? ""));
  assert.ok(item, `item ${texto} no menu`);
  await act(async () => { item.click(); });
  await settle();
}

test("botão direito numa célula abre o menu com as ações do Excel", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Etapa" } } });
  const menu = await botaoDireito(container.querySelector("#cell-B2"));
  assert.ok(menu, "o menu abriu");
  const texto = textOf(menu);
  for (const acao of [/Recortar/, /Copiar/, /Colar/, /Inserir linha acima/, /Inserir coluna à esquerda/, /Excluir linha 2/, /Ordenar/, /Inserir nota/, /Ocultar linha 2/, /Preencher à direita/]) {
    assert.match(texto, acao);
  }
  assert.equal(container.querySelector('[aria-label="Conteúdo da célula"]').closest("div").querySelector("span").textContent, "B2", "a célula clicada virou a ativa");
});

test("inserir 2 linhas abaixo de uma seleção de 2 linhas, pelo menu", async () => {
  await openWorksheet({ rows: 5, content: { ...worksheet().content, cells: { A1: "um", A2: "dois", A3: "três" } } });
  await clickCell("A1");
  await clickCell("A2", { shiftKey: true });
  await botaoDireito(container.querySelector("#cell-A2"));
  await escolherNoMenu(/Inserir 2 linhas abaixo/);
  assert.equal(container.querySelector("#cell-A2").textContent, "dois");
  assert.equal(container.querySelector("#cell-A3").textContent, "");
  assert.equal(container.querySelector("#cell-A4").textContent, "");
  assert.equal(container.querySelector("#cell-A5").textContent, "três");
});

test("ocultar a linha pelo menu tira da grade e o aviso permite reexibir", async () => {
  await openWorksheet({ rows: 4, content: { ...worksheet().content, cells: { A1: "1", A2: "2", A3: "=SOMA(A1:A2)" } } });
  await botaoDireito(container.querySelector("#cell-A2"));
  await escolherNoMenu(/Ocultar linha 2/);
  assert.equal(container.querySelector("#cell-A2"), null, "a linha saiu da tela");
  assert.equal(container.querySelector("#cell-A3").textContent, "3", "mas continua nas contas");
  assert.match(textOf(container), /1 linha\(s\) oculta\(s\)/);
  await act(async () => { findByText(container, /Reexibir linhas/, "button").click(); });
  assert.ok(container.querySelector("#cell-A2"));
});

test("nota pelo menu: marca o canto, entra no nome acessível e sai ao excluir", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "Cimento" } } });
  await botaoDireito(container.querySelector("#cell-A1"));
  await escolherNoMenu(/Inserir nota/);
  const campo = document.querySelector("#nota-da-celula");
  assert.ok(campo, "o diálogo de nota abriu");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { setter.call(campo, "Preço de 12/09"); campo.dispatchEvent(new window.Event("input", { bubbles: true })); });
  await act(async () => { campo.form.requestSubmit(); });
  await settle();
  assert.match(container.querySelector("#cell-A1").getAttribute("aria-label"), /nota: Preço de 12\/09/);
  assert.match(container.querySelector("#cell-A1").parentElement.title, /Nota: Preço de 12\/09/);
  await botaoDireito(container.querySelector("#cell-A1"));
  await escolherNoMenu(/Excluir nota/);
  assert.doesNotMatch(container.querySelector("#cell-A1").getAttribute("aria-label"), /nota/);
});

test("copiar e colar somente valores pelo menu", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "4", B1: "=A1*10" }, styles: { B1: { italic: true } } } });
  await botaoDireito(container.querySelector("#cell-B1"));
  await escolherNoMenu(/^Copiar/);
  await clickCell("C3");
  await botaoDireito(container.querySelector("#cell-C3"));
  const sub = [...document.querySelectorAll('[role="menuitem"]')].find((node) => /Colar especial/.test(node.textContent ?? ""));
  await act(async () => { sub.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  await settle();
  await escolherNoMenu(/Somente valores/);
  assert.equal(container.querySelector("#cell-C3").textContent, "40");
  assert.equal(container.querySelector("#cell-C3").style.fontStyle, "", "a formatação não veio");
  await act(async () => { container.querySelector("#cell-C3").click(); });
  assert.equal(container.querySelector('[aria-label="Conteúdo da célula"]').value, "40", "é valor, não fórmula");
});

test("Delete limpa todas as células marcadas, não só a do cursor", async () => {
  await openWorksheet({ content: { ...worksheet().content, cells: { A1: "1", B1: "2", C1: "3" } } });
  await clickCell("A1");
  await clickCell("B1", { shiftKey: true });
  await apertar(container.querySelector("#cell-B1"), "Delete");
  assert.equal(container.querySelector("#cell-A1").textContent, "");
  assert.equal(container.querySelector("#cell-B1").textContent, "");
  assert.equal(container.querySelector("#cell-C1").textContent, "3");
});

test("somente leitura: o menu só oferece copiar, filtrar e selecionar", async () => {
  const current = worksheet({ content: { ...worksheet().content, cells: { A1: "x" } } });
  const summary = { ...current }; delete summary.content;
  stubFetch({
    "/api/worksheets/data": { sources: [] },
    "/api/worksheets": { worksheets: [summary], canGovern: false },
    "/api/worksheets/w1": { worksheet: current, access: { canView: true, canEdit: false, canGovern: false, level: "view" } },
  });
  await act(async () => { reactRoot.render(React.createElement(WorksheetsWorkspace, { query: "" })); });
  await settle();
  const menu = await botaoDireito(container.querySelector("#cell-A1"));
  const texto = textOf(menu);
  assert.match(texto, /Copiar/);
  assert.match(texto, /Filtrar pelo valor/);
  for (const proibido of [/Recortar/, /Colar/, /Excluir/, /Inserir/, /Ocultar/, /nota/]) assert.doesNotMatch(texto, proibido);
});

test("pressionar o botão direito dentro da seleção não a desfaz", async () => {
  await openWorksheet({ rows: 4, content: { ...worksheet().content, cells: { A1: "um", A2: "dois" } } });
  await clickCell("A1");
  await clickCell("B2", { shiftKey: true });
  await act(async () => {
    container.querySelector("#cell-B2").dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 2, pointerType: "mouse" }));
  });
  const menu = await botaoDireito(container.querySelector("#cell-B2"));
  assert.match(textOf(menu), /A1:B2/, "o menu age sobre o intervalo marcado");
  assert.match(textOf(menu), /Excluir linhas 1–2/);
});
