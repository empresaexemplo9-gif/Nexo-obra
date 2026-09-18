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

test("clicar no cabeçalho seleciona a linha e soma a linha, não a coluna", async () => {
  await openWorksheet(comDados);

  const cabecalho = container.querySelector('[aria-label="Selecionar linha 1"]');
  assert.ok(cabecalho, "o cabeçalho da linha precisa ser selecionável");

  await act(async () => { cabecalho.click(); });
  assert.equal(cabecalho.getAttribute("aria-pressed"), "true", "a linha selecionada se anuncia como tal");

  const texto = textOf(container);
  assert.match(texto, /Total da linha 1/, "o rodapé passa a falar da linha escolhida");
  assert.match(texto, /Total da linha 1:\s*60/, "10 + 20 + 30 da linha, não os 20 da coluna A");
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
  assert.match(textOf(container), /Total da coluna A:\s*20/,
    "A1 + A2 + A3 = 20, o comportamento que já existia");

  await act(async () => { container.querySelector('[aria-label="Selecionar coluna B"]').click(); });
  assert.match(textOf(container), /Total da coluna B:\s*20/, "a coluna B tem só o 20 de B1");
});
