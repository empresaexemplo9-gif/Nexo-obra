import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } },
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0usage-test-runtime"; }, load(id) { if (id === "\0usage-test-runtime") return "export const env = globalThis.__platformEnvOverride;"; } }], server: { middlewareMode: true } });
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
    try { const result = statements.map((statement) => statement.execute()); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const usage = await vite.ssrLoadModule("/lib/server/usage.ts");
const route = await vite.ssrLoadModule("/app/api/usage/route.ts");
const superadmin = await vite.ssrLoadModule("/lib/server/superadmin.ts");

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const secret = "test-only-shared-secret-at-least-32-characters";
const TZ = "America/Sao_Paulo";
let db; let adminCookie;

const subject = (overrides = {}) => ({
  organizationId: orgA, subjectId: "owner", subjectKind: "member", email: "owner@example.test",
  displayName: "Contratante", role: "owner", memberId: orgA, timeZone: TZ, ...overrides,
});
const dayRow = (subjectId = "owner", day) => db.sqlite
  .prepare("SELECT * FROM usage_days WHERE subject_id = ? AND day = ?").get(subjectId, day);

beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  for (const [org, role, id, email] of [[orgA, "owner", "owner", "owner@example.test"], [orgB, "owner", "owner-b", "owner-b@example.test"]]) {
    db.sqlite.prepare("INSERT INTO organizations(id,name,slug,timezone,created_at,updated_at) VALUES (?,?,?,?,0,0)").run(org, org, org, TZ);
    db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,0,0)").run(id, email, "Contratante");
    db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES (?,?,?,?,?,?,'{}')")
      .run(org, org, id, "Contratante", email, role);
    db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,?,?,?,'','',1)")
      .run(org, org, id, email, CURRENT_TERMS_VERSION);
  }
  db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('colab','colab@example.test','Colaborador',0,0)").run();
  db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES ('colab',?,'colab','Colaborador','colab@example.test','member','{}')").run(orgA);
  db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES ('tc',?,'colab','colab@example.test',?,'','',1)").run(orgA, CURRENT_TERMS_VERSION);
  Object.assign(runtime, { DB: db, SUPERADMIN_EMAIL: "admin@example.test", SUPERADMIN_PASSWORD_HASH: "test-only", SUPERADMIN_SESSION_SECRET: secret });
  adminCookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

function as(externalUserId, email, organizationId = orgA, path = "/api/usage") {
  return new Request(`https://platform.test${path}`, { headers: {
    "oai-authenticated-user-id": externalUserId, "oai-authenticated-user-email": email,
    cookie: `__Host-nexo-organization=${organizationId}` } });
}

test("credita apenas o intervalo entre sinais observados e para no último sinal", async () => {
  const start = Date.parse("2026-09-10T12:00:00.000Z");
  await usage.recordUsageHeartbeat(db, subject(), start);
  assert.equal(dayRow("owner", "2026-09-10").active_ms, 0, "o primeiro sinal não credita tempo passado");

  for (let beat = 1; beat <= 4; beat += 1) {
    await usage.recordUsageHeartbeat(db, subject(), start + beat * 30_000);
  }
  // Quatro intervalos de 30s observados. A aba fechada depois disso não acrescenta nada.
  assert.equal(dayRow("owner", "2026-09-10").active_ms, 120_000);
  assert.equal(dayRow("owner", "2026-09-10").sessions, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM usage_sessions").get().n, 1);
});

test("uma ausência maior que o limite abre outra sessão e não credita o vazio", async () => {
  const start = Date.parse("2026-09-10T12:00:00.000Z");
  await usage.recordUsageHeartbeat(db, subject(), start);
  await usage.recordUsageHeartbeat(db, subject(), start + 30_000);
  await usage.recordUsageHeartbeat(db, subject(), start + 4 * 3_600_000);

  const row = dayRow("owner", "2026-09-10");
  assert.equal(row.active_ms, 30_000, "as quatro horas ausentes não entram na conta");
  assert.equal(row.sessions, 2);
  const sessions = db.sqlite.prepare("SELECT started_at, last_seen_at, ended_at, active_ms FROM usage_sessions ORDER BY started_at").all();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].ended_at, start + 30_000, "a sessão anterior encerra no último sinal recebido");
  assert.equal(sessions[1].active_ms, 0);
});

test("dois sinais simultâneos creditam uma vez só", async () => {
  const start = Date.parse("2026-09-10T12:00:00.000Z");
  await usage.recordUsageHeartbeat(db, subject(), start);
  await usage.recordUsageHeartbeat(db, subject(), start + 30_000);
  const before = dayRow("owner", "2026-09-10").active_ms;
  const session = db.sqlite.prepare("SELECT id FROM usage_sessions").get();

  // Repete a escrita do sinal anterior, como faria uma segunda requisição que leu o
  // mesmo estado. A comparação na própria instrução recusa, e o dia não recebe crédito.
  db.sqlite.prepare("UPDATE usage_sessions SET last_seen_at=?, active_ms=active_ms+30000, beats=beats+1 WHERE id=? AND ended_at IS NULL AND last_seen_at=?")
    .run(start + 30_000, session.id, start);
  db.sqlite.prepare(`INSERT INTO usage_days (organization_id,subject_id,day,subject_kind,email,display_name,role,active_ms,sessions,first_seen_at,last_seen_at)
    SELECT ?,?,?,'member','owner@example.test','Contratante','owner',30000,0,?,? WHERE changes() > 0
    ON CONFLICT(organization_id,subject_id,day) DO UPDATE SET active_ms = usage_days.active_ms + excluded.active_ms`)
    .run(orgA, "owner", "2026-09-10", start + 30_000, start + 30_000);

  assert.equal(dayRow("owner", "2026-09-10").active_ms, before);
});

test("um intervalo que cruza a meia-noite divide o tempo exato entre os dois dias", async () => {
  // 23:59:30 e 00:00:20 no fuso da empresa (UTC-3).
  const before = Date.parse("2026-09-11T02:59:30.000Z");
  const after = Date.parse("2026-09-11T03:00:20.000Z");
  await usage.recordUsageHeartbeat(db, subject(), before);
  await usage.recordUsageHeartbeat(db, subject(), after);

  assert.equal(dayRow("owner", "2026-09-10").active_ms, 30_000, "o resto do dia 10 fica no dia 10");
  assert.equal(dayRow("owner", "2026-09-11").active_ms, 20_000, "o começo do dia 11 fica no dia 11");
  const total = db.sqlite.prepare("SELECT SUM(active_ms) t FROM usage_days").get().t;
  assert.equal(total, after - before, "a soma dos dias é exatamente o intervalo observado");
  assert.equal(db.sqlite.prepare("SELECT active_ms FROM usage_sessions").get().active_ms, after - before);
});

test("abas simultâneas contam tempo de relógio, não a soma das abas", async () => {
  const start = Date.parse("2026-09-10T12:00:00.000Z");
  await usage.recordUsageHeartbeat(db, subject(), start);
  for (let beat = 1; beat <= 3; beat += 1) {
    await usage.recordUsageHeartbeat(db, subject(), start + beat * 30_000);
    await usage.recordUsageHeartbeat(db, subject(), start + beat * 30_000);
  }
  assert.equal(dayRow("owner", "2026-09-10").active_ms, 90_000);
});

test("todo acesso conta, do colaborador ao superadministrador", async () => {
  const start = Date.parse("2026-09-10T12:00:00.000Z");
  for (const person of [
    subject(),
    subject({ subjectId: "colab", subjectKind: "member", email: "colab@example.test", role: "member", memberId: "colab" }),
    subject({ subjectId: "platform-superadmin", subjectKind: "superadmin", email: "admin@example.test", role: "superadmin" }),
    subject({ subjectId: "nexo-maintenance-admin", subjectKind: "maintenance", email: "manut@example.test", role: "admin" }),
    subject({ subjectId: "cliente", subjectKind: "portal_client", email: "cliente@example.test", role: "client", memberId: null }),
  ]) {
    await usage.recordUsageHeartbeat(db, person, start);
    await usage.recordUsageHeartbeat(db, person, start + 60_000);
  }
  const rows = db.sqlite.prepare("SELECT subject_kind, active_ms FROM usage_days ORDER BY subject_kind").all();
  assert.deepEqual(rows.map((row) => row.subject_kind), ["maintenance", "member", "member", "portal_client", "superadmin"]);
  assert.ok(rows.every((row) => row.active_ms === 60_000));
});

test("cada acesso vê o próprio histórico; o contratante vê a empresa; o superadmin vê tudo", async () => {
  const start = Date.now() - 60_000;
  for (const person of [
    subject(),
    subject({ subjectId: "colab", email: "colab@example.test", role: "member", memberId: "colab" }),
    subject({ organizationId: orgB, subjectId: "owner-b", email: "owner-b@example.test", memberId: orgB }),
  ]) {
    await usage.recordUsageHeartbeat(db, person, start);
    await usage.recordUsageHeartbeat(db, person, start + 30_000);
  }

  const colaborador = await (await route.GET(as("colab", "colab@example.test"))).json();
  assert.equal(colaborador.scope, "self");
  assert.deepEqual([...new Set(colaborador.days.map((d) => d.subjectId))], ["colab"]);

  const contratante = await (await route.GET(as("owner", "owner@example.test"))).json();
  assert.equal(contratante.scope, "organization");
  assert.deepEqual([...new Set(contratante.days.map((d) => d.subjectId))].sort(), ["colab", "owner"]);
  assert.equal(contratante.days.some((d) => d.organizationId === orgB), false, "o contratante não vê outra empresa");

  const plataforma = await (await route.GET(new Request("https://platform.test/api/usage", { headers: { cookie: adminCookie } }))).json();
  assert.equal(plataforma.scope, "platform");
  assert.deepEqual([...new Set(plataforma.days.map((d) => d.organizationId))].sort(), [orgA, orgB].sort());
});

test("um acesso comum não consegue pedir o histórico de outra pessoa nem de outra empresa", async () => {
  const negado = await route.GET(as("colab", "colab@example.test", orgA, "/api/usage?subjectId=owner"));
  assert.equal(negado.status, 403);
  assert.equal((await negado.json()).code, "usage_scope_denied");
  const outraEmpresa = await route.GET(as("owner", "owner@example.test", orgA, `/api/usage?organizationId=${orgB}`));
  assert.equal(outraEmpresa.status, 403);
  assert.equal((await route.GET(as("colab", "colab@example.test", orgA, "/api/usage?from=10-09-2026&to=2026-09-11"))).status, 400);
});

test("o sinal grava pela identidade do servidor, sem aceitar empresa nem pessoa do corpo", async () => {
  const request = new Request("https://platform.test/api/usage", { method: "POST",
    headers: { "oai-authenticated-user-id": "colab", "oai-authenticated-user-email": "colab@example.test",
      "content-type": "application/json", cookie: `__Host-nexo-organization=${orgA}` },
    body: JSON.stringify({ organizationId: orgB, subjectId: "owner", activeMs: 999_999 }) });
  assert.equal((await route.POST(request)).status, 400, "campos desconhecidos no corpo são recusados");

  const limpo = new Request("https://platform.test/api/usage", { method: "POST",
    headers: { "oai-authenticated-user-id": "colab", "oai-authenticated-user-email": "colab@example.test",
      "content-type": "application/json", cookie: `__Host-nexo-organization=${orgA}` }, body: "{}" });
  assert.equal((await route.POST(limpo)).status, 200);
  const row = db.sqlite.prepare("SELECT organization_id, subject_id, active_ms FROM usage_sessions").get();
  assert.equal(row.organization_id, orgA, "a empresa vem da sessão, não do corpo");
  assert.equal(row.subject_id, "colab", "a pessoa vem da identidade autenticada");
  assert.equal(row.active_ms, 0);
});

test("as ações do período vêm da auditoria e respeitam a meia-noite local", async () => {
  const dentro = Date.parse("2026-09-10T12:00:00.000Z");
  const antes = Date.parse("2026-09-10T02:00:00.000Z");   // 23:00 do dia 9 no fuso da empresa
  for (const [id, at] of [["a", dentro], ["b", antes]]) {
    db.sqlite.prepare("INSERT INTO audit_events(id,organization_id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,'colab','client.created','client','c','{}',?)")
      .run(id, orgA, at);
  }
  const report = await usage.usageReport(db, { from: "2026-09-10", to: "2026-09-10", timeZone: TZ, organizationId: orgA });
  assert.equal(report.actions.length, 1);
  assert.equal(report.actions[0].total, 1, "a ação das 23h do dia anterior fica fora do dia 10");
  assert.equal(report.range.startedAt, Date.parse("2026-09-10T03:00:00.000Z"));
});
