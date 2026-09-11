import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Migração aplicada pela própria plataforma. Era o elo que faltava: os arquivos SQL
// existiam, mas nada os levava ao banco de produção.

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } },
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0mig-runtime"; }, load(id) { if (id === "\0mig-runtime") return "export const env = globalThis.__platformEnvOverride;"; } }], server: { middlewareMode: true } });

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
    try { const r = statements.map((s) => s.execute()); this.sqlite.exec("COMMIT"); return r; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const runner = await vite.ssrLoadModule("/lib/server/migrations.ts");
const route = await vite.ssrLoadModule("/app/api/superadmin/migrations/route.ts");
const superadmin = await vite.ssrLoadModule("/lib/server/superadmin.ts");
const overview = await vite.ssrLoadModule("/app/api/superadmin/overview/route.ts");
const worksheets = await vite.ssrLoadModule("/app/api/worksheets/route.ts");

const secret = "test-only-shared-secret-at-least-32-characters";
let db; let cookie;

beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local();
  Object.assign(runtime, { DB: db, TRUST_IDENTITY_HEADERS: "true", SUPERADMIN_EMAIL: "admin@plataforma.test", SUPERADMIN_PASSWORD_HASH: "x", SUPERADMIN_SESSION_SECRET: secret });
  cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

const admin = (init = {}) => new Request("https://platform.test/api/superadmin/migrations", { ...init,
  headers: { cookie, "content-type": "application/json", ...init.headers } });
const tables = () => db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);

test("o bundle carrega todas as migrações do repositório, em ordem", () => {
  assert.ok(runner.migrations.length >= 15, `esperava as migrações embutidas, veio ${runner.migrations.length}`);
  const ids = runner.migrations.map((item) => item.id);
  assert.deepEqual([...ids].sort(), ids, "a ordem é a do nome do arquivo");
  assert.match(ids[0], /^0000_/);
  assert.ok(runner.migrations.every((item) => item.statements.length > 0), "nenhuma migração chega vazia");
  assert.ok(runner.migrations.every((item) => item.statements.every((sql) => !sql.includes("statement-breakpoint"))),
    "o marcador de separação não sobra dentro de nenhuma instrução");
});

test("banco vazio: a plataforma cria o esquema inteiro sozinha", async () => {
  assert.equal(tables().length, 0, "começa sem tabela nenhuma");

  const antes = await (await route.GET(admin())).json();
  assert.equal(antes.applied.length, 0);
  assert.equal(antes.pending.length, runner.migrations.length, "todas pendentes");

  const resposta = await route.POST(admin({ method: "POST" }));
  assert.equal(resposta.status, 200, await resposta.clone().text());
  const resultado = await resposta.json();
  assert.equal(resultado.pending.length, 0, "não sobra nada pendente");
  assert.equal(resultado.applied.length, runner.migrations.length);

  // As tabelas de tudo que foi construído passam a existir.
  const criadas = tables();
  for (const tabela of [
    "organizations", "members", "clients", "projects", "tasks", "audit_events",
    "worksheets", "worksheet_grants", "usage_sessions", "usage_days", "goals", "reminder_states",
    "platform_access_rules", "platform_audit_events", "terms_acceptances",
  ]) {
    assert.ok(criadas.includes(tabela), `${tabela} deveria existir depois da migração`);
  }
  assert.ok(criadas.includes("_platform_migrations"), "o registro do que foi aplicado fica no banco");
});

test("depois de migrar, as rotas que estavam quebradas respondem", async () => {
  // Antes: o painel falha porque a tabela não existe.
  const antes = await overview.GET(new Request("https://platform.test/api/superadmin/overview", { headers: { cookie } }));
  assert.equal(antes.status, 503);
  const erro = await antes.json();
  assert.equal(erro.code, "database_not_migrated", "o erro diz o que fazer, em vez de falhar em silêncio");
  assert.match(erro.error, /Atualizar banco de dados/);

  await route.POST(admin({ method: "POST" }));

  const depois = await overview.GET(new Request("https://platform.test/api/superadmin/overview", { headers: { cookie } }));
  assert.equal(depois.status, 200, await depois.clone().text());
  assert.equal((await depois.json()).totals.organizations, 0);
});

test("aplicar duas vezes não repete nada nem quebra", async () => {
  await route.POST(admin({ method: "POST" }));
  const contagem = tables().length;
  const segunda = await route.POST(admin({ method: "POST" }));
  assert.equal(segunda.status, 200, await segunda.clone().text());
  assert.deepEqual((await segunda.json()).applied, [], "nada foi reaplicado");
  assert.equal(tables().length, contagem);
});

test("banco que já tinha as tabelas é reconhecido sem recriar nada", async () => {
  // Simula o banco de produção anterior: esquema antigo aplicado à mão, sem registro.
  for (const migration of runner.migrations.slice(0, 11)) {
    for (const statement of migration.statements) {
      try { db.sqlite.exec(statement); } catch { /* o esquema antigo pode divergir */ }
    }
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='worksheets'").get().n, 0,
    "as tabelas novas ainda não existem");
  db.sqlite.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES ('o','Empresa','empresa',0,0)").run();

  const resposta = await route.POST(admin({ method: "POST" }));
  assert.equal(resposta.status, 200, await resposta.clone().text());
  const resultado = await resposta.json();
  assert.equal(resultado.pending.length, 0);
  assert.ok(resultado.applied.some((item) => item.skipped > 0), "o que já existia foi reconhecido, não recriado");
  assert.ok(tables().includes("worksheets"), "e o que faltava foi criado");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM organizations").get().n, 1, "o dado que já estava lá permanece");
});

test("uma falha real de migração não é engolida", async () => {
  await db.prepare("CREATE TABLE _platform_migrations (id text PRIMARY KEY NOT NULL, statements integer NOT NULL, skipped integer NOT NULL DEFAULT 0, applied_at integer NOT NULL)").run();
  // Uma tabela incompatível com o esquema: a coluna esperada não existe e não é erro de "já existe".
  db.sqlite.exec("CREATE TABLE organizations (id text PRIMARY KEY)");
  db.sqlite.exec("CREATE TABLE members (id text PRIMARY KEY)");
  await assert.rejects(runner.applyMigrations(db), /Falha na migração/);
});

test("sem sessão de superadministrador, ninguém mexe no esquema", async () => {
  const semCookie = new Request("https://platform.test/api/superadmin/migrations", { method: "POST", headers: { "content-type": "application/json" } });
  assert.equal((await route.POST(semCookie)).status, 401);
  assert.equal((await route.GET(new Request("https://platform.test/api/superadmin/migrations"))).status, 401);
  assert.equal(tables().length, 0, "nada foi criado");

  const outroSite = admin({ method: "POST", headers: { "sec-fetch-site": "cross-site" } });
  assert.equal((await route.POST(outroSite)).status, 403);
  assert.equal(tables().length, 0);
});

test("depois de migrar, criar planilha por modelo funciona de ponta a ponta", async () => {
  await route.POST(admin({ method: "POST" }));
  const org = "11111111-1111-4111-8111-111111111111";
  db.sqlite.prepare("INSERT INTO organizations(id,name,slug,timezone,created_at,updated_at) VALUES (?,?,?,'America/Sao_Paulo',0,0)").run(org, "Empresa", "empresa");
  db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('dono','dono@example.test','Dono',0,0)").run();
  db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES ('dono',?,'dono','Dono','dono@example.test','owner','{}')").run(org);
  const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
  db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES ('t',?,'dono','dono@example.test',?,'','',1)").run(org, CURRENT_TERMS_VERSION);

  const resposta = await worksheets.POST(new Request("https://platform.test/api/worksheets", { method: "POST",
    headers: { "oai-authenticated-user-id": "dono", "oai-authenticated-user-email": "dono@example.test",
      "content-type": "application/json", cookie: `__Host-nexo-organization=${org}` },
    body: JSON.stringify({ name: "Resultado", kind: "sheet", templateId: "resultado-mensal" }) }));
  assert.equal(resposta.status, 201, await resposta.clone().text());
  assert.equal((await resposta.json()).worksheet.content.cells.A1, "Projeto ou serviço");
});
