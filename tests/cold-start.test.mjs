import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Primeiro acesso: do banco vazio até o primeiro registro real da primeira empresa.
// É o caminho que a plataforma percorre uma única vez, e o mais difícil de testar à mão.

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformTestRuntime = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } },
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0coldstart-runtime"; }, load(id) { if (id === "\0coldstart-runtime") return "export const env = globalThis.__platformTestRuntime;"; } }], server: { middlewareMode: true } });
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

const superadmin = await vite.ssrLoadModule("/lib/server/superadmin.ts");
const organizations = await vite.ssrLoadModule("/app/api/superadmin/organizations/route.ts");
const overview = await vite.ssrLoadModule("/app/api/superadmin/overview/route.ts");
const invitations = await vite.ssrLoadModule("/app/api/superadmin/invitations/route.ts");
const accept = await vite.ssrLoadModule("/app/api/invitations/[token]/accept/route.ts");
const session = await vite.ssrLoadModule("/app/api/session/route.ts");
const clients = await vite.ssrLoadModule("/app/api/clients/route.ts");
const projects = await vite.ssrLoadModule("/app/api/projects/route.ts");
const worksheets = await vite.ssrLoadModule("/app/api/worksheets/route.ts");
const reminders = await vite.ssrLoadModule("/app/api/reminders/route.ts");
const usage = await vite.ssrLoadModule("/app/api/usage/route.ts");

const secret = "test-only-shared-secret-at-least-32-characters";
const contratante = "dono@escritorio.test";
let db; let cookie;

beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  // Banco recém-migrado, sem nenhuma linha: é assim que a plataforma nasce.
  for (const migration of migrations) db.sqlite.exec(migration);
  Object.assign(runtime, { DB: db, SUPERADMIN_EMAIL: "admin@plataforma.test", SUPERADMIN_PASSWORD_HASH: "test-only", SUPERADMIN_SESSION_SECRET: secret });
  cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformTestRuntime; });

const admin = (path, init = {}) => new Request(`https://platform.test${path}`, { ...init,
  headers: { cookie, "content-type": "application/json", ...init.headers } });
const person = (id, email, organizationId, path, init = {}) => new Request(`https://platform.test${path}`, { ...init,
  headers: { "oai-authenticated-user-id": id, "oai-authenticated-user-email": email,
    "content-type": "application/json", cookie: organizationId ? `__Host-nexo-organization=${organizationId}` : "", ...init.headers } });

test("com o banco vazio, o painel abre sem inventar número e sem quebrar", async () => {
  const response = await overview.GET(admin("/api/superadmin/overview"));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.totals, { organizations: 0, members: 0, clients: 0, projects: 0, open_tasks: 0 });
  assert.deepEqual(body.organizations, []);
  assert.equal(body.maintenance.ready, false);

  // E o produto avisa que ainda não há empresa, em vez de mostrar uma tela quebrada.
  const inicial = await (await session.GET(admin("/api/session"))).json();
  assert.equal(inicial.platformEmpty, true);
  assert.equal(inicial.needsOrganization, false);
});

test("do zero ao primeiro dado real: empresa, convite, aceite e cadastro", async () => {
  // 1. O superadministrador cadastra a primeira empresa.
  const criada = await organizations.POST(admin("/api/superadmin/organizations", { method: "POST",
    body: JSON.stringify({ name: "Escritório Exemplo" }) }));
  assert.equal(criada.status, 201, await criada.clone().text());
  const { organization } = await criada.json();

  // 2. E gera o convite principal do contratante.
  const convite = await invitations.POST(admin("/api/superadmin/invitations", { method: "POST",
    body: JSON.stringify({ organizationId: organization.id, email: contratante, role: "owner", expiresInDays: 7 }) }));
  assert.equal(convite.status, 201, await convite.clone().text());
  const token = (await convite.json()).invitationPath.split("/").at(-1);

  // 3. O contratante entra com a própria conta e aceita os termos.
  const aceite = await accept.POST(
    person("dono-1", contratante, null, "/accept", { method: "POST", body: JSON.stringify({ acceptTerms: true }) }),
    { params: Promise.resolve({ token }) },
  );
  assert.equal(aceite.status, 200, await aceite.clone().text());
  assert.equal(db.sqlite.prepare("SELECT role FROM members WHERE email = ?").get(contratante).role, "owner");
  assert.equal(db.sqlite.prepare("SELECT terms_version FROM terms_acceptances").get().terms_version, CURRENT_TERMS_VERSION);

  // 4. A sessão dele já abre a empresa, com permissão total de proprietário.
  const sessao = await (await session.GET(person("dono-1", contratante, organization.id, "/api/session"))).json();
  assert.equal(sessao.authenticated, true);
  assert.equal(sessao.organization.id, organization.id);
  assert.equal(sessao.member.role, "owner");
  assert.equal(sessao.terms.accepted, true);
  assert.equal(sessao.member.permissions.finance.edit, true);

  // 5. E o primeiro dado real entra.
  const cliente = await clients.POST(person("dono-1", contratante, organization.id, "/api/clients", { method: "POST",
    body: JSON.stringify({ name: "Primeiro cliente", notes: "" }) }));
  assert.equal(cliente.status, 201, await cliente.clone().text());
  const projeto = await projects.POST(person("dono-1", contratante, organization.id, "/api/projects", { method: "POST",
    body: JSON.stringify({ code: "ARQ-001", name: "Primeira obra", kind: "work" }) }));
  assert.equal(projeto.status, 201, await projeto.clone().text());

  // 6. A partir daqui o painel da plataforma passa a contar o que é real.
  const depois = await (await overview.GET(admin("/api/superadmin/overview"))).json();
  assert.equal(depois.totals.organizations, 1);
  assert.equal(depois.totals.members, 1);
  assert.equal(depois.totals.clients, 1);
  assert.equal(depois.totals.projects, 1);
  assert.equal(depois.organizations[0].name, "Escritório Exemplo");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events").get().n >= 3, true, "cada escrita deixou registro");
});

test("empresa recém-criada não mostra número fabricado em nenhuma tela", async () => {
  const { organization } = await (await organizations.POST(admin("/api/superadmin/organizations", { method: "POST",
    body: JSON.stringify({ name: "Escritório Vazio" }) }))).json();
  // A sessão da plataforma abre a empresa pelo cookie de seleção, como no produto.
  const eu = (path, init = {}) => new Request(`https://platform.test${path}`, { ...init,
    headers: { cookie: `${cookie}; __Host-nexo-organization=${organization.id}`, "content-type": "application/json", ...init.headers } });

  const lembretes = await (await reminders.GET(eu("/api/reminders"))).json();
  assert.deepEqual(lembretes.reminders, [], "sem cobrança, prazo ou meta, não há lembrete");
  assert.deepEqual(lembretes.goals, []);

  const tempo = await (await usage.GET(eu("/api/usage"))).json();
  assert.deepEqual(tempo.days, [], "nenhum tempo online antes do primeiro acesso");

  const planilhas = await (await worksheets.GET(eu("/api/worksheets"))).json();
  assert.deepEqual(planilhas.worksheets, []);

  // O modelo criado numa empresa vazia calcula zero, e não um número de exemplo.
  const doModelo = await worksheets.POST(eu("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Resultado", kind: "sheet", templateId: "resultado-mensal" }) }));
  assert.equal(doModelo.status, 201);
  const conteudo = (await doModelo.json()).worksheet.content;
  assert.equal(Object.values(conteudo.cells).every((raw) => raw.startsWith("=") || Number.isNaN(Number(raw)) || raw === ""), true,
    "o modelo só traz cabeçalho e fórmula");
});

test("sem as credenciais do superadmin configuradas, nada é liberado", async () => {
  runtime.SUPERADMIN_EMAIL = "";
  runtime.SUPERADMIN_PASSWORD_HASH = "";
  runtime.SUPERADMIN_SESSION_SECRET = "";
  const response = await overview.GET(admin("/api/superadmin/overview"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "superadmin_not_configured");
});
