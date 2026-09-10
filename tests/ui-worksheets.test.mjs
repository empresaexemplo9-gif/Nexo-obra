import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { findByText, installDom, stubFetch, textOf } from "./dom-harness.mjs";

// Planilha na tela: escolher modelo, digitar, ver o total e respeitar o nível de acesso.

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
const { buildTemplateContent, templateById } = await vite.ssrLoadModule("/lib/worksheet-templates.ts");
after(async () => { await vite.close(); dom.cleanup(); });

let container; let reactRoot;
beforeEach(() => { container = null; reactRoot = null; });

const settle = async () => {
  for (let ciclo = 0; ciclo < 5; ciclo += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
};
async function abrir(routes) {
  if (reactRoot) await act(async () => { reactRoot.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container);
  const calls = stubFetch(routes);
  await act(async () => { reactRoot.render(React.createElement(WorksheetsWorkspace, { query: "" })); });
  await settle();
  return calls;
}

const dados = { "/api/worksheets/data": { sources: [] } };
const vazia = { ...dados, "/api/worksheets": { worksheets: [], canGovern: false } };

function planilhaSalva(overrides = {}) {
  const conteudo = buildTemplateContent(templateById("resultado-mensal"));
  return {
    id: "w1", kind: "sheet", name: "Resultado por centro", columns: conteudo.columns, rows: conteudo.rows,
    createdByName: "Contratante", revision: 1, updatedAt: Date.now(), visibility: "organization",
    content: { cells: conteudo.cells, body: "", widths: conteudo.widths, formats: {}, bold: conteudo.bold, analysis: conteudo.analysis },
    ...overrides,
  };
}

test("sem planilha, a galeria mostra os modelos com o objetivo de cada um", async () => {
  await abrir(vazia);
  const texto = textOf(container);
  assert.match(texto, /Comece por um modelo/);
  for (const modelo of ["Orçamento de obra", "Apropriação de horas", "Fluxo de caixa", "Resultado por centro", "Funil comercial"]) {
    assert.match(texto, new RegExp(modelo), `${modelo} deveria estar na galeria`);
  }
  assert.match(texto, /Projeto e obra/);
  assert.match(texto, /Financeiro/);
  assert.match(texto, /Comercial/);
  assert.match(texto, /Planilha em branco/, "quem prefere começar do zero também tem caminho");
});

test("escolher um modelo pede ao servidor pelo identificador, não pelo conteúdo", async () => {
  const calls = await abrir({
    ...dados,
    "/api/worksheets": ({ method, body }) => method === "POST"
      ? { worksheet: planilhaSalva({ name: body.name }) }
      : { worksheets: [], canGovern: false },
  });
  const cartao = [...container.querySelectorAll("button")].filter((node) => /Usar este modelo/.test(node.textContent ?? ""));
  assert.ok(cartao.length >= 8, "todo modelo tem botão");
  await act(async () => { cartao[0].click(); });
  await settle();

  const criacao = calls.find((call) => call.method === "POST");
  assert.ok(criacao, "o modelo foi criado");
  assert.equal(typeof criacao.body.templateId, "string");
  assert.equal(criacao.body.content, undefined, "o navegador não manda o conteúdo do modelo");
});

test("a planilha aberta calcula na tela conforme se digita", async () => {
  await abrir({ ...dados,
    "/api/worksheets": { worksheets: [{ ...planilhaSalva(), content: undefined }], canGovern: false },
    "/api/worksheets/w1": { worksheet: planilhaSalva(), access: { canView: true, canEdit: true, canGovern: false, level: "empresa" } } });

  const barra = container.querySelector('input[aria-label="Conteúdo da célula"]');
  assert.ok(barra, "a barra de fórmula está na tela");
  assert.match(textOf(container), /Planilha/);
  assert.ok(findByText(container, /Leitura financeira/, "button"), "a aba de leitura existe");
  assert.ok(findByText(container, /Inserir linha/), "a barra de edição está disponível");
});

test("acesso somente de leitura esconde salvar, excluir e a barra de edição", async () => {
  await abrir({ ...dados,
    "/api/worksheets": { worksheets: [{ ...planilhaSalva({ visibility: "restricted" }), content: undefined }], canGovern: false },
    "/api/worksheets/w1": { worksheet: planilhaSalva({ visibility: "restricted" }),
      access: { canView: true, canEdit: false, canGovern: false, level: "view" } },
  });
  const texto = textOf(container);
  assert.match(texto, /somente de leitura/);
  assert.match(texto, /Acesso liberado pelo superadmin/);
  assert.equal(findByText(container, /^Salvar$/), null, "não há como salvar");
  assert.equal(findByText(container, /Inserir linha/), null, "nem alterar a estrutura");
  assert.equal(container.querySelector('[aria-label="Excluir"]'), null);
});

test("quem edita vê salvar, e quem governa vê a aba de acesso", async () => {
  await abrir({ ...dados,
    "/api/worksheets": { worksheets: [{ ...planilhaSalva({ kind: "analysis", visibility: "restricted" }), content: undefined }], canGovern: true },
    "/api/worksheets/w1": { worksheet: planilhaSalva({ kind: "analysis", visibility: "restricted" }),
      access: { canView: true, canEdit: true, canGovern: true, level: "superadmin" } },
  });
  assert.ok(findByText(container, /^Salvar$/), "quem edita salva");
  assert.ok(findByText(container, /Acesso/, "button"), "quem governa libera acesso");
  assert.match(textOf(container), /Saúde financeira/);
});

test("o superadmin tem o botão da planilha de saúde financeira; os demais, não", async () => {
  await abrir({ ...dados, "/api/worksheets": { worksheets: [], canGovern: true } });
  assert.ok(findByText(container, /Nova planilha de saúde financeira/));

  await abrir(vazia);
  assert.equal(findByText(container, /Nova planilha de saúde financeira/), null);
});

test("falha ao carregar aparece na tela, sem esconder o erro", async () => {
  await abrir({ ...dados, "/api/worksheets": () => ({ __status: 500, error: "Banco indisponível." }) });
  assert.match(textOf(container), /Banco indisponível/);
});
