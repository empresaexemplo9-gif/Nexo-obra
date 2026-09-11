import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { findByText, installDom, stubFetch, textOf } from "./dom-harness.mjs";

// Interface da planilha: o que a pessoa vê e o que acontece quando ela clica.
// Monta os componentes de verdade, com os efeitos rodando e a API respondendo em teste.

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
const { AnalysisPanel, GrantsPanel } = await vite.ssrLoadModule("/components/analysis-panel.tsx");
after(async () => { await vite.close(); dom.cleanup(); });

let container; let reactRoot;
beforeEach(() => {
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container);
});

const render = async (element) => { await act(async () => { reactRoot.render(element); }); };
// Alguns painéis buscam na API dentro de um efeito. Sem esperar, a asserção cai no
// estado "Carregando…" e o teste passa a depender da velocidade da máquina.
const settle = async () => {
  for (let ciclo = 0; ciclo < 5; ciclo += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
};
const click = async (node) => { assert.ok(node, "elemento não encontrado na tela"); await act(async () => { node.click(); }); };

const planilha = {
  A1: "Setor", B1: "Horas", C1: "Receita", D1: "Custo equipe",
  A2: "Obra", B2: "200", C2: "40000", D2: "48000",
  A3: "Projeto", B3: "100", C3: "30000", D3: "15000",
};
const papeis = { A: "setor", B: "horas", C: "receita", D: "custo_colaborador" };
const settings = (overrides = {}) => ({ headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [], ...overrides });

test("planilha vazia convida a trazer dado, sem mostrar número", async () => {
  await render(React.createElement(AnalysisPanel, {
    cells: {}, columns: 4, rows: 10, settings: settings(), canEdit: true, onChange: () => {},
  }));
  const texto = textOf(container);
  assert.match(texto, /ainda está vazia/);
  assert.doesNotMatch(texto, /R\$/, "sem dado, nenhum valor aparece");
});

test("com dado e sem papéis, a tela diz o que falta em vez de calcular", async () => {
  await render(React.createElement(AnalysisPanel, {
    cells: planilha, columns: 4, rows: 10, settings: settings(), canEdit: true, onChange: () => {},
  }));
  const texto = textOf(container);
  assert.match(texto, /A leitura ainda não pode ser feita/);
  assert.match(texto, /Marque uma coluna como Receita/);
  assert.doesNotMatch(texto, /Onde a operação está/, "nenhum total é exibido antes dos papéis");
});

test("a sugestão de papéis é oferecida e só se aplica no clique", async () => {
  let aplicado = null;
  await render(React.createElement(AnalysisPanel, {
    cells: planilha, columns: 4, rows: 10, settings: settings(), canEdit: true,
    onChange: (next) => { aplicado = next; },
  }));
  assert.match(textOf(container), /parecem ser/, "a sugestão aparece");
  assert.equal(aplicado, null, "e nada foi aplicado sozinho");

  await click(findByText(container, "Aplicar sugestão"));
  assert.ok(aplicado, "o clique aplica");
  assert.equal(aplicado.roles.C, "receita");
  assert.equal(aplicado.roles.D, "custo_colaborador");
  assert.equal(aplicado.roles.B, "horas");
});

test("com os papéis marcados, a tela mostra os números e onde perde", async () => {
  await render(React.createElement(AnalysisPanel, {
    cells: planilha, columns: 4, rows: 10, settings: settings({ roles: papeis }), canEdit: true, onChange: () => {},
  }));
  const texto = textOf(container);
  assert.match(texto, /Onde a operação está/);
  assert.match(texto, /R\$\s*70\.000,00/, "receita somada");
  assert.match(texto, /R\$\s*63\.000,00/, "custo somado");
  assert.match(texto, /Obra dá prejuízo/);
  assert.match(texto, /Projeto é onde você mais ganha/);
  assert.match(texto, /Onde ganha e onde perde/);
});

test("mudar a margem alvo muda a recomendação de preço", async () => {
  let atual = settings({ roles: papeis, targetMarginPercent: 20 });
  const mostrar = async () => render(React.createElement(AnalysisPanel, {
    cells: planilha, columns: 4, rows: 10, settings: atual, canEdit: true,
    onChange: (next) => { atual = next; },
  }));
  await mostrar();
  const campo = [...container.querySelectorAll("input[type=number]")]
    .find((input) => input.value === "20");
  assert.ok(campo, "o campo da margem alvo está na tela");

  // Custo 63.000 com meta de 40% pede receita de 105.000: 50% acima dos 70.000 atuais.
  atual = settings({ roles: papeis, targetMarginPercent: 40 });
  await mostrar();
  assert.match(textOf(container), /Aumente o preço em 50%/);
});

test("acesso de leitura não deixa mexer na configuração da análise", async () => {
  await render(React.createElement(AnalysisPanel, {
    cells: planilha, columns: 4, rows: 10, settings: settings({ roles: papeis }), canEdit: false, onChange: () => {},
  }));
  const seletores = [...container.querySelectorAll("select")];
  assert.ok(seletores.length > 0);
  assert.equal(seletores.every((select) => select.disabled), true, "os papéis ficam travados");
  assert.equal([...container.querySelectorAll("input")].every((input) => input.disabled), true);
  assert.equal(findByText(container, "Aplicar sugestão"), null, "nem a sugestão é oferecida");
});

test("a linha de totais fora da conta evita a contagem dobrada na tela", async () => {
  const comTotal = { ...planilha, A4: "Total", C4: "=SOMA(C2:C3)", D4: "=SOMA(D2:D3)" };
  await render(React.createElement(AnalysisPanel, {
    cells: comTotal, columns: 4, rows: 10, settings: settings({ roles: papeis }), canEdit: true, onChange: () => {},
  }));
  assert.match(textOf(container), /R\$\s*140\.000,00/, "sem marcar, a linha de totais dobra a receita");

  await render(React.createElement(AnalysisPanel, {
    cells: comTotal, columns: 4, rows: 10, settings: settings({ roles: papeis, ignoreRows: [3] }), canEdit: true, onChange: () => {},
  }));
  const texto = textOf(container);
  assert.match(texto, /R\$\s*70\.000,00/, "marcada, a receita volta ao valor real");
  assert.match(texto, /não contar duas vezes/);
});

test("o quadro de liberações lista a equipe e grava a mudança de nível", async () => {
  const calls = stubFetch({
    "/api/worksheets/abc/grants": ({ method, body }) => method === "POST"
      ? { saved: true, memberId: body.memberId, level: body.level }
      : { worksheet: { id: "abc", name: "Saúde financeira", visibility: "restricted" },
          members: [
            { id: "m1", name: "Ana Arquiteta", email: "ana@example.test", role: "manager", level: "none" },
            { id: "m2", name: "Bruno Financeiro", email: "bruno@example.test", role: "finance", level: "view" },
          ] },
  });
  await render(React.createElement(GrantsPanel, { worksheetId: "abc" }));
  await settle();
  const texto = textOf(container);
  assert.match(texto, /Ana Arquiteta/);
  assert.match(texto, /Bruno Financeiro/);
  assert.match(texto, /fechada por padrão/);

  const seletor = [...container.querySelectorAll("select")][0];
  assert.equal(seletor.value, "none", "quem não foi liberado aparece sem acesso");
  await act(async () => {
    seletor.value = "edit";
    seletor.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  const gravado = calls.find((call) => call.method === "POST");
  assert.ok(gravado, "a mudança foi enviada");
  assert.deepEqual(gravado.body, { memberId: "m1", level: "edit" });
});
