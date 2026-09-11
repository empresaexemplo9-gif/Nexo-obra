import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Matriz de acesso: o que cada perfil enxerga por padrão, e as duas regras que impedem
// alguém de crescer sozinho — ninguém libera mais do que tem, e ninguém se promove.

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
const migrations = await Promise.all((await readdir(`${root}/drizzle`)).filter((file) => file.endsWith(".sql")).sort().map((file) => readFile(`${root}/drizzle/${file}`, "utf8")));

class D1Local {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql) {
    const sqlite = this.sqlite;
    return new (class {
      args = [];
      bind(...args) { this.args = args; return this; }
      execute() {
        const statement = sqlite.prepare(sql);
        const bindings = Object.fromEntries(this.args.map((value, i) => [i + 1, value]));
        const results = statement.all(bindings);
        return { success: true, results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } };
      }
      async all() { return this.execute(); }
      async run() { return this.execute(); }
      async first() { return this.execute().results[0] ?? null; }
    })();
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const result = statements.map((s) => s.execute()); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const permissions = await vite.ssrLoadModule("/lib/permissions.ts");
const inviteRoute = await vite.ssrLoadModule("/app/api/organization-invitations/route.ts");
const accept = await vite.ssrLoadModule("/app/api/invitations/[token]/accept/route.ts");
const clients = await vite.ssrLoadModule("/app/api/clients/route.ts");
const finance = await vite.ssrLoadModule("/app/api/integrations/drap/summary/route.ts");

const org = "11111111-1111-4111-8111-111111111111";
const full = () => Object.fromEntries(permissions.permissionModules.map((m) => [m, { view: true, edit: true }]));
let db;

function addMember(id, role, matrix) {
  db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,0,0)").run(id, `${id}@example.test`, id);
  db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES (?,?,?,?,?,?,?)")
    .run(id, org, id, id, `${id}@example.test`, role, JSON.stringify(matrix ?? permissions.permissionsForRole(role)));
  db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,?,?,?,'','',1)")
    .run(id, org, id, `${id}@example.test`, CURRENT_TERMS_VERSION);
}
const as = (id, path, init = {}) => new Request(`https://platform.test${path}`, { ...init,
  headers: { "oai-authenticated-user-id": id, "oai-authenticated-user-email": `${id}@example.test`,
    "content-type": "application/json", cookie: `__Host-nexo-organization=${org}`, ...init.headers } });

beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  db.sqlite.prepare("INSERT INTO organizations(id,name,slug,timezone,created_at,updated_at) VALUES (?,?,?,'America/Sao_Paulo',0,0)").run(org, org, org);
  Object.assign(runtime, { DB: db, TRUST_IDENTITY_HEADERS: "true" });
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

test("cada perfil nasce com a matriz que o produto promete", () => {
  const matrix = (role) => Object.fromEntries(Object.entries(permissions.permissionsForRole(role))
    .filter(([, grant]) => grant.view).map(([module, grant]) => [module, grant.edit ? "edita" : "vê"]));

  // Contratante e administrador: tudo.
  for (const role of ["owner", "admin"]) {
    assert.equal(Object.values(permissions.permissionsForRole(role)).every((g) => g.view && g.edit), true, role);
  }
  // Gestor: opera a produção, mas só lê financeiro e equipe.
  const gestor = matrix("manager");
  assert.equal(gestor.projects, "edita");
  assert.equal(gestor.budgets, "edita");
  assert.equal(gestor.finance, "vê");
  assert.equal(gestor.team, "vê");
  // Colaborador: executa tarefa, lê o resto do que precisa, não toca em dinheiro.
  const colaborador = matrix("member");
  assert.equal(colaborador.tasks, "edita");
  assert.equal(colaborador.finance, undefined);
  assert.equal(colaborador.crm, undefined);
  // Parceiro: só leitura, nada de dinheiro nem equipe.
  assert.equal(Object.values(permissions.permissionsForRole("partner")).every((g) => !g.edit), true);
  assert.equal(matrix("partner").finance, undefined);
  // Financeiro edita dinheiro e orçamento, e só lê projeto.
  const financeiro = matrix("finance");
  assert.equal(financeiro.finance, "edita");
  assert.equal(financeiro.budgets, "edita");
  assert.equal(financeiro.projects, "vê");
  // Contabilidade: prestação de contas, somente leitura.
  assert.equal(Object.values(permissions.permissionsForRole("accounting")).every((g) => !g.edit), true);
  assert.equal(matrix("accounting").finance, "vê");
  // Nenhum perfil abaixo de administrador edita a equipe.
  for (const role of ["manager", "member", "partner", "service_provider", "finance", "accounting"]) {
    assert.equal(permissions.permissionsForRole(role).team.edit, false, role);
  }
});

test("marcar edição concede a leitura necessária, e um papel desconhecido não ganha nada", () => {
  const normalized = permissions.normalizePermissions({ finance: { view: false, edit: true } }, "member");
  assert.deepEqual(normalized.finance, { view: true, edit: true }, "quem edita precisa enxergar");
  assert.equal(Object.values(permissions.permissionsForRole("papel-inventado")).every((g) => !g.view && !g.edit), true);
  // O contratante e a plataforma são sempre totais, venha o que vier gravado.
  for (const role of ["owner", "superadmin"]) {
    assert.equal(Object.values(permissions.normalizePermissions({ finance: { view: false, edit: false } }, role)).every((g) => g.view && g.edit), true, role);
  }
});

test("um administrador não libera acesso que ele mesmo não tem", async () => {
  // Administrador de equipe, sem nenhum acesso ao Financeiro.
  addMember("admin-sem-financeiro", "admin", { ...full(), finance: { view: false, edit: false } });

  const escalada = await inviteRoute.POST(as("admin-sem-financeiro", "/api/organization-invitations", { method: "POST",
    body: JSON.stringify({ email: "comparsa@example.test", role: "finance", expiresInDays: 7,
      permissions: { ...full(), finance: { view: true, edit: true } } }) }));
  assert.equal(escalada.status, 403);
  const body = await escalada.json();
  assert.equal(body.code, "permission_beyond_grantor");
  assert.match(body.error, /Financeiro/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM organization_invitations").get().n, 0);

  // Dentro do próprio alcance, o convite passa normalmente.
  const dentro = await inviteRoute.POST(as("admin-sem-financeiro", "/api/organization-invitations", { method: "POST",
    body: JSON.stringify({ email: "colega@example.test", role: "member", expiresInDays: 7,
      permissions: { ...full(), finance: { view: false, edit: false } } }) }));
  assert.equal(dentro.status, 201, await dentro.clone().text());
});

test("o contratante libera qualquer área, porque já tem todas", async () => {
  addMember("dono", "owner");
  const response = await inviteRoute.POST(as("dono", "/api/organization-invitations", { method: "POST",
    body: JSON.stringify({ email: "financeiro@example.test", role: "finance", expiresInDays: 7,
      permissions: { ...full(), finance: { view: true, edit: true } } }) }));
  assert.equal(response.status, 201, await response.clone().text());
});

test("quem não administra equipe não cria acesso nenhum", async () => {
  addMember("gestor", "manager");
  addMember("colaborador", "member");
  for (const quem of ["gestor", "colaborador"]) {
    const response = await inviteRoute.POST(as(quem, "/api/organization-invitations", { method: "POST",
      body: JSON.stringify({ email: "novo@example.test", role: "member", expiresInDays: 7, permissions: full() }) }));
    assert.equal([403].includes(response.status), true, `${quem} não deveria convidar`);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM organization_invitations").get().n, 0);
});

test("a permissão do convite é a que vale no aceite, não a que o convidado pedir", async () => {
  addMember("dono", "owner");
  const criado = await (await inviteRoute.POST(as("dono", "/api/organization-invitations", { method: "POST",
    body: JSON.stringify({ email: "restrito@example.test", role: "member", expiresInDays: 7,
      permissions: { ...full(), finance: { view: false, edit: false }, crm: { view: false, edit: false } } }) }))).json();
  const token = criado.invitationPath.split("/").at(-1);

  // Pedir papel e permissões no corpo do aceite não é negociação: o formato é fechado,
  // então a tentativa para em cima da validação, antes de qualquer gravação.
  const tentativa = await accept.POST(new Request("https://platform.test/accept", { method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-id": "restrito", "oai-authenticated-user-email": "restrito@example.test" },
    body: JSON.stringify({ acceptTerms: true, permissions: full(), role: "owner" }) }),
    { params: Promise.resolve({ token }) });
  assert.equal(tentativa.status, 400, "campos fora do formato do aceite são recusados");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM members WHERE email = 'restrito@example.test'").get().total, 0,
    "a tentativa recusada não cria vínculo nenhum");

  const aceite = await accept.POST(new Request("https://platform.test/accept", { method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-id": "restrito", "oai-authenticated-user-email": "restrito@example.test" },
    body: JSON.stringify({ acceptTerms: true }) }),
    { params: Promise.resolve({ token }) });
  assert.equal(aceite.status, 200, await aceite.clone().text());

  const gravado = db.sqlite.prepare("SELECT role, permissions_json FROM members WHERE email = 'restrito@example.test'").get();
  assert.equal(gravado.role, "member", "o papel vem do convite, não do corpo do aceite");
  assert.equal(JSON.parse(gravado.permissions_json).finance.view, false);

  // E a restrição vale nas rotas: sem CRM e sem Financeiro, as duas fecham.
  assert.equal((await clients.GET(as("restrito", "/api/clients"))).status, 403);
  assert.equal((await finance.GET(as("restrito", "/api/integrations/drap/summary"))).status, 403);
});

test("um convite não muda o papel de quem já é contratante da empresa", async () => {
  addMember("dono", "owner");
  const criado = await (await inviteRoute.POST(as("dono", "/api/organization-invitations", { method: "POST",
    body: JSON.stringify({ email: "dono@example.test", role: "member", expiresInDays: 7, permissions: full() }) }))).json();
  const token = criado.invitationPath.split("/").at(-1);
  const aceite = await accept.POST(new Request("https://platform.test/accept", { method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-id": "dono", "oai-authenticated-user-email": "dono@example.test" },
    body: JSON.stringify({ acceptTerms: true }) }), { params: Promise.resolve({ token }) });
  assert.equal(aceite.status, 200, await aceite.clone().text());
  assert.equal(db.sqlite.prepare("SELECT role FROM members WHERE email='dono@example.test'").get().role, "owner",
    "aceitar um convite menor não rebaixa o contratante");
});
