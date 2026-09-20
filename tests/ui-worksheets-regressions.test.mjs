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
beforeEach(() => {
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
