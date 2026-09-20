import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { installDom, stubFetch, findByText, textOf } from "./dom-harness.mjs";
const dom = installDom();
const React = (await import("react")).default;
const { act } = await import("react"), { createRoot } = await import("react-dom/client");
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
const { TasksWorkspace } = await vite.ssrLoadModule("/components/tasks-workspace.tsx");
const { FilesWorkspace } = await vite.ssrLoadModule("/components/files-workspace.tsx");
const { BudgetsWorkspace } = await vite.ssrLoadModule("/components/budgets-workspace.tsx");
const { ClientsDirectory } = await vite.ssrLoadModule("/components/clients-directory.tsx");
const { TeamAccessManager } = await vite.ssrLoadModule("/components/team-access-manager.tsx");
const { DrapSolutionsWorkspace } = await vite.ssrLoadModule("/components/drap-solutions-workspace.tsx");
const { ProposedTermsPage } = await vite.ssrLoadModule("/components/proposed-terms-page.tsx");
let container, reactRoot;
const originalFormData = globalThis.FormData, originalFile = globalThis.File;
test.beforeEach(async () => {
  if (reactRoot) await act(async () => reactRoot.unmount()); container?.remove();
  container = document.createElement("div"); document.body.append(container); reactRoot = createRoot(container);
  globalThis.FormData = window.FormData; globalThis.File = window.File;
});
test.after(async () => { if (reactRoot) await act(async () => reactRoot.unmount()); await vite.close(); dom.cleanup(); globalThis.FormData = originalFormData; globalThis.File = originalFile; });
const settle = async () => { for (let i=0;i<5;i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
async function mount(Component, props) { await act(async () => reactRoot.render(React.createElement(Component, props))); await settle(); }
const task = { id: "t1", projectId: "p1", projectName: "Obra", title: "Revisar planta", status: "done", priority: "normal", assigneeMemberId: null, assigneeName: null, startsAt: null, dueAt: null, estimatedMinutes: 120, parentTaskId: null, description: "Conferir medidas" };

test("editar tarefa reabre e preserva descrição", async () => {
  let body; let changed = 0;
  globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ task: { ...task, ...body } }), { status: 200 }); };
  await mount(TasksWorkspace, { tasks: [task], members: [], query: "", canEdit: true, onCreate() {}, onChanged: async () => { changed++; } });
  await act(async () => container.querySelector('[aria-label="Editar tarefa Revisar planta"]').click());
  const dialog = document.querySelector('[role="dialog"]');
  dialog.querySelector('[name="status"]').value = "todo";
  await act(async () => dialog.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  await settle(); assert.equal(body.status, "todo"); assert.equal(body.description, "Conferir medidas"); assert.equal(changed, 1);
});

test("erro ao editar tarefa mantém dados e formulário para correção", async () => {
  let changed = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Dependência inválida" }), { status: 400 });
  await mount(TasksWorkspace, { tasks: [task], members: [], query: "", canEdit: true, onCreate() {}, onChanged: async () => { changed++; } });
  await act(async () => container.querySelector('[aria-label="Editar tarefa Revisar planta"]').click());
  const dialog = document.querySelector('[role="dialog"]'); dialog.querySelector('[name="title"]').value = "Título corrigido";
  await act(async () => dialog.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  assert.match(textOf(dialog), /Dependência inválida/); assert.equal(dialog.querySelector('[name="title"]').value, "Título corrigido"); assert.equal(changed, 0);
});
test("acesso de leitura não oferece edição nem criação de tarefa", async () => {
  await mount(TasksWorkspace, { tasks: [task], members: [], query: "", canEdit: false, onCreate() {}, onChanged: async () => {} });
  assert.equal(findByText(container, "Nova tarefa", "button"), null); assert.equal(findByText(container, "Editar", "button"), null);
});
test("upload concluído limpa formulário depois de resposta assíncrona", async () => {
  const file = new window.File(["relatório"], "relatorio.txt", { type: "text/plain" });
  globalThis.FormData = class extends window.FormData { constructor(form) { super(form); this.set("file", file); } };
  let uploaded = false, reads = 0;
  globalThis.fetch = async (_url, init) => { await Promise.resolve(); if (init?.method === "POST") uploaded = true; else reads++; return new Response(JSON.stringify(init?.method === "POST" ? { file: {} } : { files: [] }), { status: 200 }); };
  await mount(FilesWorkspace, { projects: [{ id: "p1", code: "P1", name: "Obra" }], query: "", canEdit: true });
  const form = container.querySelector("form"); let reset = 0; form.reset = () => { reset++; };
  await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  await settle(); assert.equal(uploaded, true); assert.equal(reset, 1); assert.ok(reads >= 2);
});
test("orçamento enviado oferece aprovação, cópia e relatório; esconde inclusão", async () => {
  const budget = { id: "b1", projectId: "p1", projectName: "Obra", code: "ORC", version: 1, status: "sent", directCostCents: 100, bdiPercent: 0, marginPercent: 0, totalCents: 100, itemCount: 1 };
  stubFetch({ "/api/budgets": { budgets: [budget] }, "/api/budget-library": { items: [] }, "/api/budgets/b1/items": { items: [{ id: "i1", description: "Serviço", unit: "un", quantity: 1, unitCostCents: 100, unitPriceCents: 100, totalCents: 100, source: "manual" }] } });
  await mount(BudgetsWorkspace, { projects: [{ id: "p1", name: "Obra" }], query: "", canEdit: true });
  assert.ok(findByText(container, "Registrar aprovação", "button")); assert.ok(findByText(container, "Copiar para nova versão", "button"));
  assert.equal(findByText(container, "Adicionar item", "button"), null); assert.equal(findByText(container, "Marcar como enviado", "button"), null);
  assert.ok(container.querySelector('a[href="/api/budgets/b1/report"]'));
});
test("cliente pode ter contato corrigido sem recriar cadastro", async () => {
  let path, body;
  globalThis.fetch = async (url, init) => { path=url; body=JSON.parse(init.body); return new Response(JSON.stringify({ client: body }), { status: 200 }); };
  await mount(ClientsDirectory, { clients: [{ id:"c1", name:"Cliente", email:"old@example.test", phone:null, document:null }], query:"", canEdit:true, onChanged:async()=>{} });
  await act(async () => container.querySelector('[aria-label="Editar cliente Cliente"]').click());
  const dialog=document.querySelector('[role="dialog"]'); dialog.querySelector('[name="email"]').value="new@example.test";
  await act(async () => dialog.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
  assert.equal(path,"/api/clients/c1"); assert.equal(body.email,"new@example.test");
});
test("leitor da equipe não consulta convites restritos", async () => {
  let calls=0; globalThis.fetch=async()=>{ calls++; throw new Error("Não deveria consultar"); };
  await mount(TeamAccessManager,{members:[],canManage:false}); assert.equal(calls,0); assert.doesNotMatch(textOf(container), /Carregando convites/);
  assert.equal(container.querySelector('.animate-spin'), null);
});

test("minuta distingue desenvolvedora de operadora e não oferece aceite", async () => {
  await mount(ProposedTermsPage, {});
  assert.match(textOf(container), /sem vigência contratual/);
  assert.match(textOf(container), /A Drap desenvolve a H.OIKOS para venda à adquirente/);
  assert.doesNotMatch(textOf(container), /64\.759\.314/);
  assert.ok(container.querySelector('a[href*="l13709compilado"]'));
  assert.ok(container.querySelector('a[href*="l12378"]'));
  assert.equal(container.querySelector('button, input[type="checkbox"]'), null);
  assert.equal(container.querySelectorAll('nav a[href^="#clausula-"]').length, 14);
});

test("seleção Drap é salva sem inventar cobrança ou checkout e leitores não alteram", async () => {
  const catalog = { catalog: [{ id: 'cobrancas', name: 'Cobranças', kind: 'module', monthlyCents: 7375, description: 'Cobranças da empresa' }], checkedAt: '2026-09-16', selection: [], canManage: true, provisioningAvailable: false, tenantProvisioned: true, connectionStatus: 'active', subscription: null };
  let saved;
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'POST') { assert.equal(url, '/api/integrations/drap/selection'); saved = JSON.parse(init.body); return new Response(JSON.stringify({ saved: true, contracted: false })); }
    return new Response(JSON.stringify(catalog));
  };
  await mount(DrapSolutionsWorkspace, {});
  assert.match(textOf(container), /73,75/);
  await act(async () => findByText(container, 'Selecionar', 'button').click());
  await act(async () => findByText(container, 'Salvar seleção', 'button').click());
  assert.deepEqual(saved, { itemIds: ['cobrancas'] });
  assert.match(textOf(container), /Nenhuma contratação ou cobrança foi realizada/);
  await act(async () => reactRoot.unmount()); reactRoot = createRoot(container);
  catalog.canManage = false; await mount(DrapSolutionsWorkspace, {});
  assert.equal(findByText(container, 'Selecionar', 'button').disabled, true);
  assert.equal(findByText(container, 'Salvar seleção', 'button').disabled, true);
});

test("falha ao trocar versão de orçamento não mostra itens da versão anterior", async () => {
  const base = { projectId:"p1",projectName:"Obra",version:1,status:"draft",bdiPercent:0,marginPercent:0,totalCents:100,directCostCents:100,itemCount:1 };
  stubFetch({
    "/api/budgets": { budgets: [{...base,id:"b1",code:"PRIMEIRO"},{...base,id:"b2",code:"SEGUNDO"}] },
    "/api/budget-library": { items: [] },
    "/api/budgets/b1/items": {items:[{id:"i1",description:"Item exclusivo da primeira versão",unit:"un",quantity:1,unitCostCents:100,unitPriceCents:100,totalCents:100}]},
    "/api/budgets/b2/items": {__status:503,error:"Itens indisponíveis"},
  });
  await mount(BudgetsWorkspace,{projects:[],query:"",canEdit:true});
  assert.match(textOf(container),/Item exclusivo da primeira versão/);
  await act(async()=>findByText(container,"SEGUNDO · v1","button").click()); await settle();
  assert.match(textOf(container),/Itens indisponíveis/); assert.doesNotMatch(textOf(container),/Item exclusivo da primeira versão/);
  assert.ok(findByText(container,"Recarregar itens","button"));
});
