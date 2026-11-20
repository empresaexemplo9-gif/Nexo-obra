import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

// Três decisões por empresa: módulos contratados (do superadmin), identidade visual (do
// contratante) e criação de login delegada a gestores. Rotas, SQL e migrações reais.

const h = await createHarness();
after(() => h.close());
beforeEach(() => {
  h.reset();
  Object.assign(h.runtime, { SESSION_SECRET: "s".repeat(40), LINK_ACESSO_CHAVE: "k".repeat(40) });
});

const sessionRoute = await h.load("/app/api/session/route.ts");
const clientsRoute = await h.load("/app/api/clients/route.ts");
const membersRoute = await h.load("/app/api/members/route.ts");
const modulosRoute = await h.load("/app/api/superadmin/organizations/[organizationId]/modulos/route.ts");
const brandingRoute = await h.load("/app/api/organization/branding/route.ts");
const logoRoute = await h.load("/app/api/organization/branding/logo/route.ts");
const contasRoute = await h.load("/app/api/members/contas/route.ts");
const delegacaoRoute = await h.load("/app/api/members/[memberId]/delegacao/route.ts");
const superadmin = await h.load("/lib/server/superadmin.ts");
const auth = await h.load("/lib/server/auth.ts");
const config = await h.load("/lib/empresa-config.ts");

const cookieOf = (setCookie) => setCookie.split(";")[0];
async function comoSuperadmin(path, init = {}) {
  const link = cookieOf(await superadmin.createLinkAccessCookie());
  return new Request(`https://platform.test${path}`, { ...init, headers: { cookie: link, "content-type": "application/json", ...(init.headers ?? {}) } });
}
const desligar = (org, enabled) => h.db.sqlite.prepare("INSERT INTO organization_modules (organization_id, enabled_json, revision, updated_by, updated_at) VALUES (?,?,1,'t',0)")
  .run(org, JSON.stringify(enabled));
// Formato anterior (lista de módulos de dados), que continua sendo lido.
const semCrm = ["projects", "budgets", "schedule", "diary", "portal", "finance", "tasks", "files", "studio", "purchases"];
const ligar = (org, ferramentas) => h.db.sqlite.prepare("INSERT INTO organization_modules (organization_id, enabled_json, revision, updated_by, updated_at) VALUES (?,?,1,'t',0)")
  .run(org, JSON.stringify({ ferramentas }));
const conversasRoute = await h.load("/app/api/conversas/route.ts");
const projectsRoute = await h.load("/app/api/projects/route.ts");

test("módulo desligado some da sessão e a API recusa, só naquela empresa", async () => {
  desligar(orgA, semCrm);
  const sessao = await (await sessionRoute.GET(h.request("owner", "/api/session"))).json();
  assert.equal(sessao.organization.enabledModules.includes("crm"), false);
  assert.deepEqual(sessao.member.permissions.crm, { view: false, edit: false }, "nem o contratante usa o que não contratou");
  assert.equal(sessao.member.permissions.projects.edit, true);

  const recusado = await clientsRoute.GET(h.request("owner", "/api/clients"));
  assert.equal(recusado.status, 403);
  assert.equal((await recusado.json()).code, "module_permission_denied");
  // A outra empresa não é afetada.
  assert.equal((await clientsRoute.GET(h.request("owner-b", "/api/clients", { org: orgB }))).status, 200);
});

test("cada item do menu é uma escolha: Comunicação e Obras desligadas, o resto segue", async () => {
  const semComunicacaoNemObras = config.todasAsFerramentas.filter((id) => id !== "comunicacao" && id !== "works");
  ligar(orgA, semComunicacaoNemObras);
  const sessao = await (await sessionRoute.GET(h.request("owner", "/api/session"))).json();
  assert.equal(sessao.organization.enabledTools.includes("comunicacao"), false);
  assert.equal(sessao.organization.enabledTools.includes("projects"), true);

  const conversa = await conversasRoute.GET(h.request("owner", "/api/conversas"));
  assert.equal(conversa.status, 403);
  assert.equal((await conversa.json()).code, "tool_not_contracted");
  assert.equal((await conversasRoute.GET(h.request("owner-b", "/api/conversas", { org: orgB }))).status, 200, "outra empresa não muda");

  const novo = (kind) => projectsRoute.POST(h.request("owner", "/api/projects", { method: "POST", json: { name: "Casa Nova", code: `C-${kind}`, kind, phase: "briefing", budgetCents: 0 } }));
  assert.equal((await novo("work")).status, 403, "sem Obras, não cadastra obra");
  assert.equal((await novo("project")).status, 201, "com Projetos, cadastra projeto");
});

test("empresa sem nenhuma ferramenta não acessa dados de tela nenhuma", async () => {
  ligar(orgA, []);
  const sessao = await (await sessionRoute.GET(h.request("owner", "/api/session"))).json();
  assert.deepEqual(sessao.organization.enabledTools, []);
  assert.equal((await clientsRoute.GET(h.request("owner", "/api/clients"))).status, 403);
  assert.equal((await projectsRoute.GET(h.request("owner", "/api/projects"))).status, 403);
});

test("banco sem a migração nova continua funcionando com tudo liberado", async () => {
  h.db.sqlite.exec("DROP TABLE organization_modules; DROP TABLE organization_branding; DROP TABLE member_delegations;");
  const resposta = await sessionRoute.GET(h.request("owner", "/api/session"));
  assert.equal(resposta.status, 200);
  const sessao = await resposta.json();
  assert.equal(sessao.organization.enabledModules.length, 13);
  assert.equal(sessao.organization.enabledTools.length, config.todasAsFerramentas.length);
  assert.equal(sessao.branding.hasLogo, false);
  assert.equal((await clientsRoute.GET(h.request("owner", "/api/clients"))).status, 200);
});

test("só o superadmin liga e desliga módulos, com revisão e rastro", async () => {
  const url = `/api/superadmin/organizations/${orgA}/modulos`;
  // Contratante não alcança a rota da plataforma.
  // (401 com o superadmin configurado; 503 aqui, onde só o link de acesso está.)
  const dono = await modulosRoute.PUT(h.request("owner", url, { method: "PUT", json: { enabled: [], revision: 0 } }), params({ organizationId: orgA }));
  assert.ok([401, 503].includes(dono.status), String(dono.status));
  assert.equal(h.db.sqlite.prepare("SELECT count(*) n FROM organization_modules").get().n, 0);

  const lido = await (await modulosRoute.GET(await comoSuperadmin(url), params({ organizationId: orgA }))).json();
  assert.equal(lido.revision, 0);
  assert.equal(lido.ferramentas.length, config.todasAsFerramentas.length, "sem escolha, tudo ligado");

  const salvo = await modulosRoute.PUT(await comoSuperadmin(url, { method: "PUT", body: JSON.stringify({ ferramentas: ["tasks", "comunicacao"], revision: 0 }) }), params({ organizationId: orgA }));
  assert.equal(salvo.status, 200);
  const corpo = await salvo.json();
  assert.deepEqual(corpo.ferramentas, ["comunicacao", "tasks"]);
  assert.deepEqual(corpo.modulos, ["overview", "projects", "team", "tasks"], "Tarefas precisa dos projetos; visão geral e equipe são dados de base");
  // Ferramenta inventada não entra.
  const invalido = await modulosRoute.PUT(await comoSuperadmin(url, { method: "PUT", body: JSON.stringify({ ferramentas: ["hackear"], revision: 1 }) }), params({ organizationId: orgA }));
  assert.equal(invalido.status, 400);

  // Revisão velha não sobrescreve.
  const velho = await modulosRoute.PUT(await comoSuperadmin(url, { method: "PUT", body: JSON.stringify({ ferramentas: [], revision: 0 }) }), params({ organizationId: orgA }));
  assert.equal(velho.status, 409);
  const rastro = h.db.sqlite.prepare("SELECT count(*) n FROM platform_audit_events WHERE organization_id = ? AND action = 'platform.modules_changed'").get(orgA);
  assert.equal(rastro.n, 1);
});

test("administrador ainda gerencia quem tem módulo desligado gravado no cadastro", async () => {
  desligar(orgA, semCrm);
  h.member("adm", orgA, "Administradora", "admin", permissions());
  const alvo = h.member("colab", orgA, "Colaborador", "member", permissions({}, true));
  const { members } = await (await membersRoute.GET(h.request("adm", "/api/members"))).json();
  const atual = members.find((m) => m.id === alvo);
  const resposta = await membersRoute.PATCH(h.request("adm", "/api/members", { method: "PATCH", json: {
    id: alvo, role: "member", permissions: atual.permissions, active: true, weeklyCapacityMinutes: 2400, updatedAt: atual.updatedAt,
  } }));
  assert.equal(resposta.status, 200);
});

test("cor clara da marca é escurecida até o texto branco ficar legível", async () => {
  const resposta = await brandingRoute.PUT(h.request("owner", "/api/organization/branding", { method: "PUT", json: {
    menuColor: "#ffe600", accentColor: "#1a7f37", bandColor: null, revision: 0,
  } }));
  assert.equal(resposta.status, 200);
  const { branding, adjusted } = await resposta.json();
  assert.ok(config.contraste(branding.menuColor, "#ffffff") >= 4.5);
  assert.equal(branding.accentColor, "#1a7f37", "cor já legível não muda");
  assert.deepEqual(adjusted, ["menu"]);
  const sessao = await (await sessionRoute.GET(h.request("owner", "/api/session"))).json();
  assert.equal(sessao.branding.menuColor, branding.menuColor);
});

test("só quem administra muda a marca, e o arquivo precisa ser imagem de verdade", async () => {
  h.member("gestor", orgA, "Gestor", "manager", permissions());
  const corpo = { menuColor: null, accentColor: null, bandColor: null, revision: 0 };
  assert.equal((await brandingRoute.PUT(h.request("gestor", "/api/organization/branding", { method: "PUT", json: corpo }))).status, 403);

  const falso = Buffer.from("<svg onload=alert(1)>").toString("base64");
  const recusado = await brandingRoute.PUT(h.request("owner", "/api/organization/branding", { method: "PUT", json: { ...corpo, logo: { mime: "image/png", base64: falso } } }));
  assert.equal(recusado.status, 415);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).toString("base64");
  const aceito = await brandingRoute.PUT(h.request("owner", "/api/organization/branding", { method: "PUT", json: { ...corpo, logo: { mime: "image/png", base64: png } } }));
  assert.equal(aceito.status, 200);
  assert.equal((await aceito.json()).branding.hasLogo, true);

  const imagem = await logoRoute.GET(h.request("owner", "/api/organization/branding/logo"));
  assert.equal(imagem.status, 200);
  assert.equal(imagem.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await imagem.arrayBuffer()).toString("base64"), png);
  // A outra empresa não enxerga o logotipo desta.
  assert.equal((await logoRoute.GET(h.request("owner-b", "/api/organization/branding/logo", { org: orgB }))).status, 404);
});

test("gestor só cria login depois que o contratante libera, e só abaixo do cargo dele", async () => {
  const gestor = h.member("gestor", orgA, "Gestora", "manager", permissions({ finance: { view: true, edit: false } }));
  const pedido = (json, user = "gestor") => contasRoute.POST(h.request(user, "/api/members/contas", { method: "POST", json }));
  const base = { name: "Novo Colaborador", email: "novo@example.test", password: "SenhaForte123", role: "member", permissions: { tasks: { view: true, edit: true } } };

  assert.equal((await pedido(base)).status, 403, "sem a ferramenta, recusa");

  // Gestor não entrega a ferramenta a si mesmo nem a outro.
  assert.equal((await delegacaoRoute.PUT(h.request("gestor", `/api/members/${gestor}/delegacao`, { method: "PUT", json: { canCreateAccounts: true } }), params({ memberId: gestor }))).status, 403);
  const liberado = await delegacaoRoute.PUT(h.request("owner", `/api/members/${gestor}/delegacao`, { method: "PUT", json: { canCreateAccounts: true } }), params({ memberId: gestor }));
  assert.equal(liberado.status, 200);
  const sessaoGestor = await (await sessionRoute.GET(h.request("gestor", "/api/session"))).json();
  assert.equal(sessaoGestor.member.canCreateAccounts, true);

  assert.equal((await pedido({ ...base, role: "manager" })).status, 403, "não cria cargo igual ao seu");
  const alem = await pedido({ ...base, permissions: { finance: { view: true, edit: true } } });
  assert.equal(alem.status, 403, "não libera edição do Financeiro que ele mesmo não tem");
  assert.equal((await alem.json()).code, "permission_beyond_grantor");
  assert.equal((await pedido({ ...base, password: "curta" })).status, 400);

  const criado = await pedido(base);
  assert.equal(criado.status, 201);
  const entrada = await auth.signIn(new Request("https://platform.test/api/auth/sign-in"), "novo@example.test", "SenhaForte123");
  assert.equal(entrada.email, "novo@example.test");
  const membro = h.db.sqlite.prepare("SELECT role, organization_id FROM members WHERE lower(email) = 'novo@example.test'").get();
  assert.deepEqual({ ...membro }, { role: "member", organization_id: orgA });
  const rastro = h.db.sqlite.prepare("SELECT metadata_json FROM audit_events WHERE action = 'member.account_created'").get();
  assert.doesNotMatch(rastro.metadata_json, /SenhaForte123/, "a senha nunca vai para o rastro");

  // E-mail que já tem senha não ganha outra: seria tomar a conta da pessoa.
  const repetido = await pedido({ ...base, email: "novo@example.test" });
  assert.equal(repetido.status, 409);
});

test("sem delegação um colaborador não cria login, e o contratante cria qualquer cargo", async () => {
  h.member("colab", orgA, "Colaborador", "member", permissions());
  const corpo = { name: "Fulana Gestora", email: "fulana@example.test", password: "SenhaForte123", role: "admin", permissions: {} };
  assert.equal((await contasRoute.POST(h.request("colab", "/api/members/contas", { method: "POST", json: corpo }))).status, 403);
  assert.equal((await contasRoute.POST(h.request("owner", "/api/members/contas", { method: "POST", json: corpo }))).status, 201);
});

test("o Financeiro nasce com todos os acessos e a hierarquia de cargos é estrita", () => {
  assert.equal(config.podeCriarPerfil("manager", "member"), true);
  assert.equal(config.podeCriarPerfil("manager", "manager"), false);
  assert.equal(config.podeCriarPerfil("member", "partner"), true);
  assert.equal(config.podeCriarPerfil("admin", "admin"), false);
  assert.equal(config.podeCriarPerfil("owner", "admin"), true);
  assert.equal(config.podeCriarPerfil("manager", "papel-inventado"), false);
  assert.ok(config.contraste(config.ajustarParaTextoBranco("#fafafa"), "#ffffff") >= 4.5);
});

const marcaSuperRoute = await h.load("/app/api/superadmin/organizations/[organizationId]/marca/route.ts");
const logoSuperRoute = await h.load("/app/api/superadmin/organizations/[organizationId]/marca/logo/route.ts");

test("a paleta inteira sai das cores da marca, sempre legível", () => {
  assert.deepEqual(config.paletaCompleta(null), {}, "sem marca, vale a paleta da plataforma");
  for (const marca of [
    { menuColor: null, accentColor: "#ffe600", bandColor: null },          // amarelo claro
    { menuColor: "#7a0019", accentColor: "#e30613", bandColor: "#b0001e" }, // vermelhos
    { menuColor: null, accentColor: "#00a859", bandColor: null },          // verde vivo
    { menuColor: "#ffffff", accentColor: "#f5f5f5", bandColor: "#eeeeee" }, // tudo branco
  ]) {
    const p = config.paletaCompleta(marca);
    for (const escuro of ["--drap-deep", "--drap-band", "--drap-accent", "--drap-graphite"]) {
      assert.ok(config.contraste(p[escuro], "#ffffff") >= 4.5, `${escuro} de ${JSON.stringify(marca)} recebe texto branco`);
    }
    assert.ok(config.contraste(p["--drap-ink"], p["--drap-stone"]) >= 15, "texto principal sobre o fundo");
    assert.ok(config.contraste(p["--drap-support"], p["--drap-paper"]) >= 9, "texto secundário sobre os cartões");
    assert.ok(config.contraste(p["--drap-paper"], "#000000") > 18, "cartões continuam claros");
  }
});

test("o superadmin envia o logotipo de qualquer empresa e a empresa passa a usar a marca", async () => {
  const url = `/api/superadmin/organizations/${orgA}/marca`;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).toString("base64");
  const corpo = { menuColor: "#123456", accentColor: "#e30613", bandColor: null, logo: { mime: "image/png", base64: png }, revision: 0 };

  // O contratante não alcança a rota da plataforma.
  const dono = await marcaSuperRoute.PUT(h.request("owner", url, { method: "PUT", json: corpo }), params({ organizationId: orgA }));
  assert.ok([401, 503].includes(dono.status));

  const salvo = await marcaSuperRoute.PUT(await comoSuperadmin(url, { method: "PUT", body: JSON.stringify(corpo) }), params({ organizationId: orgA }));
  assert.equal(salvo.status, 200);
  assert.equal((await salvo.json()).branding.hasLogo, true);
  assert.equal(h.db.sqlite.prepare("SELECT count(*) n FROM platform_audit_events WHERE action = 'platform.branding_changed'").get().n, 1);
  assert.equal((await logoSuperRoute.GET(await comoSuperadmin(`${url}/logo`), params({ organizationId: orgA }))).status, 200);

  // A equipe da empresa recebe a marca na sessão; a outra empresa não.
  const sessao = await (await sessionRoute.GET(h.request("owner", "/api/session"))).json();
  assert.equal(sessao.branding.accentColor, "#e30613");
  assert.equal(sessao.marca, "drap");
  assert.equal((await logoRoute.GET(h.request("owner", "/api/organization/branding/logo"))).status, 200);
  const outra = await (await sessionRoute.GET(h.request("owner-b", "/api/session", { org: orgB }))).json();
  assert.equal(outra.branding.hasLogo, false);
});
