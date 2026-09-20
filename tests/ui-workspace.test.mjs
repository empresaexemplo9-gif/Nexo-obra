import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { findByText, installDom, stubFetch, textOf } from "./dom-harness.mjs";

// Produto: o que cada acesso enxerga no menu, e o que a tela recusa a mostrar.
// A permissão já é decidida no servidor; aqui se verifica que a tela obedece.

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
const { NexoApp } = await vite.ssrLoadModule("/components/nexo-app.tsx");
const { permissionsForRole } = await vite.ssrLoadModule("/lib/permissions.ts");
after(async () => { await vite.close(); dom.cleanup(); });

let container; let reactRoot;
beforeEach(async () => {
  if (reactRoot) await act(async () => { reactRoot.unmount(); });
  container?.remove();
  container = null;
  reactRoot = null;
});

const vazio = { clients: [], projects: [], tasks: [], members: [] };
function sessionFor(role, overrides = {}) {
  return {
    authenticated: true, authMethod: "password", needsOrganization: false,
    user: { id: "u1", email: "pessoa@example.test", displayName: "Pessoa" },
    member: { id: "m1", role, permissions: permissionsForRole(role) },
    terms: { version: "2026-09-10", accepted: true },
    organization: { id: "org", name: "Escritório Exemplo", slug: "escritorio", timezone: "America/Sao_Paulo" },
    organizations: [{ id: "org", name: "Escritório Exemplo", slug: "escritorio", timezone: "America/Sao_Paulo" }],
    maintenanceEnvironment: false,
    ...overrides,
  };
}
function routes(session, extra = {}) {
  return {
    "/api/session": session,
    "/api/clients": { clients: vazio.clients },
    "/api/projects": { projects: vazio.projects },
    "/api/tasks": { tasks: vazio.tasks },
    "/api/members": { members: vazio.members },
    "/api/reminders": { day: "2026-09-10", horizon: "2026-09-17", seen: false, reminders: [], dismissedCount: 0, counts: { atrasado: 0, hoje: 0, proximo: 0 }, goals: [] },
    "/api/usage": { range: { from: "2026-09-01", to: "2026-09-10" }, today: "2026-09-10", scope: "self", beatMs: 30000, gapLimitMs: 90000, viewer: { subjectId: "u1", role: "member", displayName: "Pessoa" }, days: [], actions: [] },
    "/api/worksheets": { worksheets: [], canGovern: false },
    "/api/goals": { goals: [], metrics: [], canManage: false },
    "/api/health": { pronto: true, banco: "ok", sessao: "ok", superadmin: "ok", armazenamento: "ok" },
    ...extra,
  };
}
async function abrir(session, extra) {
  if (reactRoot) await act(async () => { reactRoot.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  reactRoot = createRoot(container);
  const calls = stubFetch(routes(session, extra));
  await act(async () => { reactRoot.render(React.createElement(NexoApp)); });
  for (let ciclo = 0; ciclo < 5; ciclo += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  return calls;
}
const menu = () => [...container.querySelectorAll('[data-sidebar="menu-button"], nav a, nav button')]
  .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);

test("falha de clientes não bloqueia projetos e CRM sem Equipe não consulta membros", async () => {
  const session = sessionFor("manager"); session.member.permissions.team = { view: false, edit: false };
  const calls = await abrir(session, {
    "/api/clients": { __status: 503, error: "Clientes indisponíveis" },
    "/api/projects": { projects: [{ id: "p1", code: "REV-01", name: "Trabalho disponível", kind: "project", status: "active", phase: "Executivo", progressPercent: 30 }] },
  });
  assert.match(textOf(container), /Clientes indisponíveis/);
  assert.ok(!calls.some(call => call.path.includes("/api/members")));
  const button = [...container.querySelectorAll('[data-sidebar="menu-button"]')].find(node => /^Projetos/.test(node.textContent.trim()));
  assert.ok(button); await act(async () => button.click());
  assert.match(textOf(container), /Trabalho disponível/);
  assert.doesNotMatch(textOf(container), /Clientes indisponíveis/);
});

test("Cronograma com permissão independente carrega planejamento e mostra tarefas sem lista de projetos", async () => {
  const session = sessionFor("partner");
  session.member.permissions.tasks = { view: false, edit: false };
  session.member.permissions.projects = { view: false, edit: false };
  const calls = await abrir(session, { "/api/schedule": { tasks: [{ id: "t1", projectId: "p1", projectName: "Obra autorizada", title: "Entrega planejada", status: "todo", priority: "normal", startsAt: "2026-09-20", dueAt: "2026-09-25", parentTaskId: null, assigneeName: null, estimatedMinutes: 60 }] } });
  assert.ok(!calls.some(call => call.path.includes("/api/tasks") || call.path.includes("/api/projects")));
  const button = [...container.querySelectorAll('[data-sidebar="menu-button"]')].find(node => /Cronograma/.test(node.textContent));
  assert.ok(button); await act(async () => button.click());
  assert.match(textOf(container), /Entrega planejada/); assert.match(textOf(container), /Obra autorizada/);
});

test("visão geral prioriza tarefas vencidas e mostra projetos persistidos", async () => {
  await abrir(sessionFor("owner"), {
    "/api/projects": { projects: [{ id: "p1", name: "Projeto de teste", code: "T-01", kind: "project", status: "active", phase: "Executivo", progressPercent: 45 }] },
    "/api/tasks": { tasks: [
      { id: "t2", projectId: "p1", projectName: "Projeto de teste", title: "Entrega futura", status: "todo", dueAt: "2099-01-01T12:00:00Z" },
      { id: "t1", projectId: "p1", projectName: "Projeto de teste", title: "Entrega vencida", status: "todo", dueAt: "2020-01-01T12:00:00Z" },
      { id: "t3", projectId: "p1", projectName: "Projeto de teste", title: "Entrega concluída", status: "done", dueAt: null },
    ] },
  });
  assert.match(textOf(container), /Prazos que precisam de atenção/);
  const rows = [...container.querySelectorAll(".hoikos-task-row")];
  assert.equal(rows.length, 2);
  assert.match(textOf(rows[0]), /Entrega vencida/);
  assert.ok(container.querySelector('a[href="/projetos/p1"]'));
  assert.equal(container.querySelector(".hoikos-start"), null);
});

test("primeiros passos respeitam acesso somente leitura", async () => {
  await abrir(sessionFor("partner"));
  const overview = container.querySelector(".hoikos-overview");
  assert.ok(overview);
  assert.equal(findByText(overview, /Novo projeto|Criar projeto|Cadastrar cliente/, "button"), null);
  assert.ok(findByText(overview, "Ver lembretes", "button"));
});

test("o contratante enxerga todos os módulos do menu", async () => {
  await abrir(sessionFor("owner"));
  const texto = textOf(container);
  for (const modulo of ["Visão geral", "Projetos", "Obras", "Orçamentos", "Clientes", "Financeiro", "Equipe", "Tarefas", "Arquivos"]) {
    assert.match(texto, new RegExp(modulo), `${modulo} deveria aparecer`);
  }
});

test("o colaborador não vê Financeiro, Clientes nem Equipe no menu", async () => {
  await abrir(sessionFor("member"));
  const itens = menu().join(" | ");
  assert.match(itens, /Tarefas/, "vê o que é dele");
  assert.doesNotMatch(itens, /Financeiro/, "não vê dinheiro");
  assert.doesNotMatch(itens, /Clientes/);
  assert.doesNotMatch(itens, /Equipe/);
});

test("o parceiro entra em leitura: sem botão de criar", async () => {
  await abrir(sessionFor("partner"));
  assert.equal(findByText(container, /^Criar$/), null, "parceiro não cria registro");
  await abrir(sessionFor("manager"));
  assert.ok(findByText(container, /Criar/), "o gestor cria");
});

test("Lembretes e Tempo de uso aparecem mesmo para quem não tem permissão nenhuma", async () => {
  const semNada = sessionFor("member");
  for (const modulo of Object.keys(semNada.member.permissions)) {
    semNada.member.permissions[modulo] = { view: false, edit: false };
  }
  await abrir(semNada);
  const itens = menu().join(" | ");
  assert.match(itens, /Lembretes do dia/, "todo acesso é lembrado do que precisa fazer");
  assert.match(itens, /Tempo de uso/, "e todo acesso vê o próprio tempo");
  assert.match(itens, /Planilha/, "e tem a planilha para trabalhar");
});

test("o sino mostra a contagem do que está atrasado ou vence hoje", async () => {
  await abrir(sessionFor("owner"), {
    "/api/reminders": { day: "2026-09-10", horizon: "2026-09-17", seen: false, dismissedCount: 0,
      counts: { atrasado: 2, hoje: 1, proximo: 5 }, goals: [],
      reminders: [{ key: "boleto:1", group: "boleto", severity: "atrasado", title: "Boleto vencido: Medição 3",
        detail: "R$ 12.000,00", amountCents: 1200000, dueDay: "2026-09-05", module: "finance", entityId: "1" }] },
  });
  const sino = container.querySelector('[aria-label*="Lembretes do dia"]');
  assert.ok(sino, "o sino está no cabeçalho");
  assert.match(sino.getAttribute("aria-label"), /3 para hoje ou atrasados/);
  assert.match(textOf(sino), /3/);
  await act(async () => { sino.click(); });
  assert.match(textOf(container), /Boleto vencido: Medição 3/, "o clique abre a lista");
});

test("o selo de superadmin e o ambiente de manutenção aparecem quando é o caso", async () => {
  await abrir(sessionFor("superadmin", { authMethod: "superadmin" }));
  assert.match(textOf(container), /Superadmin · acesso total/);
  assert.ok(findByText(container, /Painel da plataforma/, "a"), "há caminho de volta ao painel");
  await abrir(sessionFor("admin", { authMethod: "superadmin", maintenanceEnvironment: true }));
  assert.match(textOf(container), /Ambiente de manutenção/);
});

test("plataforma sem empresa manda para o painel em vez de mostrar tela vazia", async () => {
  await abrir({ authenticated: true, authMethod: "superadmin", needsOrganization: false, platformEmpty: true,
    user: { id: "platform-superadmin", email: "admin@plataforma.test", displayName: "Superadministrador" }, organizations: [] });
  const texto = textOf(container);
  assert.match(texto, /Nenhuma empresa cadastrada/);
  assert.ok(findByText(container, /Abrir painel da plataforma/, "a"));
});

test("a tela de acesso mostra o que falta na instalação, em vez de deixar o botão falhar", async () => {
  await abrir({ authenticated: false, needsOrganization: false, organizations: [] }, {
    "/api/health": { pronto: false, banco: "nao_configurado", sessao: "ok", superadmin: "ok", armazenamento: "nao_configurado" },
  });
  const texto = textOf(container);
  assert.match(texto, /Instalação incompleta/);
  assert.match(texto, /Banco de dados não configurado/);
  assert.match(texto, /Armazenamento de arquivos não configurado/);
  assert.doesNotMatch(texto, /SESSION_SECRET/, "área saudável não vira ruído");
  await abrir({ authenticated: false, needsOrganization: false, organizations: [] }, {
    "/api/health": { pronto: false, banco: "falta_migrar", sessao: "ok", superadmin: "ok", armazenamento: "ok",
      migracoes: { aplicadas: 0, pendentes: 16 } },
  });
  assert.match(textOf(container), /sem as tabelas.*Atualizar banco de dados/s);
  await abrir({ authenticated: false, needsOrganization: false, organizations: [] }, {
    "/api/health": { pronto: true, banco: "ok", sessao: "ok", superadmin: "ok", armazenamento: "ok" },
  });
  assert.doesNotMatch(textOf(container), /Instalação incompleta/);
});

test("sem sessão, a tela pede e-mail e senha e não vaza nada da empresa", async () => {
  await abrir({ authenticated: false, needsOrganization: false, organizations: [] }, {
    "/api/health": { pronto: true, banco: "ok", sessao: "ok", superadmin: "ok", armazenamento: "ok" },
  });
  const texto = textOf(container);
  assert.doesNotMatch(texto, /Escritório Exemplo/);
  assert.ok(container.querySelector("#account-email"), "pede o e-mail da conta");
  assert.ok(container.querySelector("#account-password"), "pede a senha da conta");
  assert.doesNotMatch(texto, /ChatGPT/, "nada do produto depende de conta de terceiro");
  assert.ok(container.querySelector("#initial-superadmin-email"));
});

test("os termos pendentes bloqueiam o produto até o aceite", async () => {
  await abrir(sessionFor("owner", { terms: { version: "2026-09-10", accepted: false } }));
  const texto = textOf(container);
  assert.match(texto, /Termos de Uso/);
  assert.doesNotMatch(texto, /Visão geral/, "nada do produto abre antes do aceite");
});

// A tela de criar registro tinha um beco sem saída: sem nenhum projeto cadastrado, a aba
// Tarefa abria um select vazio e um botão desabilitado, sem dizer o motivo nem oferecer
// saída. Quem chegava ali só via a interface recusar, sem explicação.
test("sem projeto, a aba Tarefa explica o motivo e oferece o caminho", async () => {
  await abrir(sessionFor("owner"));
  // O diálogo monta em portal, fora do container da aplicação.
  await act(async () => { findByText(document.body, "Criar", "button").click(); });
  const dialogo = () => document.body.querySelector('[role="dialog"]');
  await act(async () => { findByText(dialogo(), "Tarefa", "button").click(); });

  const texto = textOf(dialogo());
  assert.match(texto, /Toda tarefa pertence a um projeto/, "diz por que não dá para criar");
  assert.ok(findByText(dialogo(), "Cadastrar projeto primeiro", "button"), "e oferece a saída");
  assert.equal(dialogo().querySelector('select[name="projectId"]'), null,
    "não mostra um select sem nenhuma opção");
  assert.equal(dialogo().querySelector('button[type="submit"]'), null,
    "nem um botão de salvar que não salva");
});
