import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

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

const reminders = await vite.ssrLoadModule("/app/api/reminders/route.ts");
const goals = await vite.ssrLoadModule("/app/api/goals/route.ts");
const goalItem = await vite.ssrLoadModule("/app/api/goals/[goalId]/route.ts");

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
let db;

const permissions = (overrides = {}) => JSON.stringify({
  overview: { view: true, edit: true }, projects: { view: true, edit: true }, budgets: { view: true, edit: true },
  schedule: { view: true, edit: true }, diary: { view: true, edit: true }, portal: { view: true, edit: true },
  crm: { view: true, edit: true }, finance: { view: true, edit: true }, team: { view: true, edit: true },
  tasks: { view: true, edit: true }, files: { view: true, edit: true }, ...overrides,
});
const none = permissions({
  overview: { view: false, edit: false }, projects: { view: false, edit: false }, budgets: { view: false, edit: false },
  schedule: { view: false, edit: false }, diary: { view: false, edit: false }, portal: { view: false, edit: false },
  crm: { view: false, edit: false }, finance: { view: false, edit: false }, team: { view: false, edit: false },
  tasks: { view: false, edit: false }, files: { view: false, edit: false },
});

// O dia é calculado no mesmo fuso que o servidor usa. Com toISOString() o teste passava
// a depender da hora em que rodasse: perto da meia-noite UTC, "hoje" divergia.
const day = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
  .format(new Date(Date.now() + offset * 86_400_000));
const ms = (offset) => Date.now() + offset * 86_400_000;

beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  for (const [org, id, email] of [[orgA, "owner", "owner@example.test"], [orgB, "owner-b", "owner-b@example.test"]]) {
    db.sqlite.prepare("INSERT INTO organizations(id,name,slug,timezone,created_at,updated_at) VALUES (?,?,?,'America/Sao_Paulo',0,0)").run(org, org, org);
    db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,0,0)").run(id, email, "Contratante");
    db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES (?,?,?,?,?,'owner',?)")
      .run(org, org, id, "Contratante", email, permissions());
    db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,?,?,?,'','',1)")
      .run(org, org, id, email, CURRENT_TERMS_VERSION);
  }
  db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('colab','colab@example.test','Colaborador',0,0)").run();
  db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES ('colab',?,'colab','Colaborador','colab@example.test','member',?)").run(orgA, none);
  db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES ('tc',?,'colab','colab@example.test',?,'','',1)").run(orgA, CURRENT_TERMS_VERSION);
  db.sqlite.prepare("INSERT INTO projects(id,organization_id,code,name,type,kind,status,created_at,updated_at) VALUES ('p',?,'ARQ-1','Casa Alfa','work','work','active',0,0)").run(orgA);
  Object.assign(runtime, { DB: db, TRUST_IDENTITY_HEADERS: "true" });
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

function as(id, email, org = orgA, path = "/api/reminders", init = {}) {
  return new Request(`https://platform.test${path}`, { ...init, headers: {
    "oai-authenticated-user-id": id, "oai-authenticated-user-email": email,
    "content-type": "application/json", cookie: `__Host-nexo-organization=${org}`, ...init.headers } });
}
const owner = (path = "/api/reminders", init) => as("owner", "owner@example.test", orgA, path, init);
const agendaFor = async (request) => (await (await reminders.GET(request)).json());

function charge(id, { status = "created", due = day(0), amount = 150000 } = {}) {
  db.sqlite.prepare(`INSERT INTO financial_charge_requests(id,organization_id,project_id,idempotency_key,description,amount_cents,due_date,reminder_policy_json,status,created_at,updated_at)
    VALUES (?,?,'p',?,?,?,?,'{}',?,?,?)`).run(id, orgA, id, `Cobrança ${id}`, amount, due, status, day(0), day(0));
}

test("junta cobrança, boleto, follow-up, tarefa e meta no lembrete do dia", async () => {
  charge("c1", { status: "pending" });
  charge("c2", { status: "created", due: day(-3) });
  charge("c3", { status: "created", due: day(3) });
  charge("c4", { status: "created", due: day(60) });
  db.sqlite.prepare("INSERT INTO crm_opportunities(id,organization_id,title,stage,next_action,next_action_at,created_at,updated_at) VALUES ('o1',?,'Reforma Beta','proposal','Ligar para o cliente',?,?,?)")
    .run(orgA, day(0), day(0), day(0));
  db.sqlite.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,priority,due_at,created_at,updated_at) VALUES ('t1',?,'p','Enviar medição','todo','high',?,?,?)")
    .run(orgA, ms(-1), ms(-5), ms(-5));
  db.sqlite.prepare("INSERT INTO goals(id,organization_id,name,metric,target_value,period_start,period_end,created_by_name,active,created_at,updated_at) VALUES ('g1',?,'Clientes do mês','clients_new',10,?,?,'Contratante',1,0,0)")
    .run(orgA, day(-10), day(10));

  const agenda = await agendaFor(owner());
  const groups = agenda.reminders.map((item) => item.group);
  assert.ok(groups.includes("cobranca"));
  assert.ok(groups.includes("boleto"));
  assert.ok(groups.includes("followup"));
  assert.ok(groups.includes("tarefa"));
  assert.ok(groups.includes("meta"));
  assert.equal(agenda.reminders.some((item) => item.entityId === "c4"), false, "vencimento distante fica fora do dia");
  assert.equal(agenda.reminders.find((item) => item.entityId === "c2").severity, "atrasado");
  assert.equal(agenda.reminders.find((item) => item.entityId === "c3").severity, "proximo");
  assert.equal(agenda.reminders.find((item) => item.entityId === "t1").severity, "atrasado");
});

test("o lembrete some sozinho quando o registro deixa de estar pendente", async () => {
  charge("c1", { status: "created", due: day(0) });
  db.sqlite.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,priority,due_at,created_at,updated_at) VALUES ('t1',?,'p','Medição','todo','high',?,0,0)").run(orgA, ms(0));
  assert.equal((await agendaFor(owner())).reminders.length, 2);

  db.sqlite.prepare("UPDATE financial_charge_requests SET status='paid' WHERE id='c1'").run();
  db.sqlite.prepare("UPDATE tasks SET status='done' WHERE id='t1'").run();
  assert.equal((await agendaFor(owner())).reminders.length, 0);
});

test("dispensar vale só para o dia, só para quem dispensou, e não mexe no registro", async () => {
  charge("c1", { status: "created", due: day(0) });
  const dispensado = await reminders.POST(owner("/api/reminders", { method: "POST", body: JSON.stringify({ itemKey: "boleto:c1", state: "dismissed" }) }));
  assert.equal(dispensado.status, 200);
  assert.equal((await dispensado.json()).reminders.length, 0);
  assert.equal(db.sqlite.prepare("SELECT status FROM financial_charge_requests WHERE id='c1'").get().status, "created");

  // Outro dia, o lembrete volta.
  db.sqlite.prepare("UPDATE reminder_states SET day = ?").run(day(-1));
  assert.equal((await agendaFor(owner())).reminders.length, 1);
});

test("cada acesso recebe o que a permissão dele permite, e a tarefa própria sempre chega", async () => {
  charge("c1", { status: "created", due: day(0) });
  db.sqlite.prepare("INSERT INTO crm_opportunities(id,organization_id,title,stage,next_action,next_action_at,created_at,updated_at) VALUES ('o1',?,'Lead','new','Ligar',?,?,?)").run(orgA, day(0), day(0), day(0));
  db.sqlite.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,priority,due_at,assignee_member_id,created_at,updated_at) VALUES ('t1',?,'p','Minha tarefa','todo','high',?, 'colab',0,0)").run(orgA, ms(0));
  db.sqlite.prepare("INSERT INTO tasks(id,organization_id,project_id,title,status,priority,due_at,assignee_member_id,created_at,updated_at) VALUES ('t2',?,'p','Tarefa de outro','todo','high',?, ?,0,0)").run(orgA, ms(0), orgA);

  const semPermissao = await agendaFor(as("colab", "colab@example.test"));
  assert.deepEqual(semPermissao.reminders.map((item) => item.entityId), ["t1"],
    "sem leitura em Financeiro, CRM e Tarefas, sobra apenas a tarefa atribuída a ela");

  const doContratante = await agendaFor(owner());
  assert.ok(doContratante.reminders.some((item) => item.group === "boleto"));
  assert.ok(doContratante.reminders.some((item) => item.group === "followup"));
  assert.equal(doContratante.reminders.filter((item) => item.group === "tarefa").length, 2);
});

test("o realizado da meta é calculado do dado real, não digitado", async () => {
  db.sqlite.prepare("INSERT INTO goals(id,organization_id,name,metric,target_value,period_start,period_end,created_by_name,active,created_at,updated_at) VALUES ('g1',?,'Clientes','clients_new',4,?,?,'Contratante',1,0,0)")
    .run(orgA, day(-5), day(5));
  for (const [id, at] of [["c1", ms(-1)], ["c2", ms(-2)], ["c3", ms(-30)]]) {
    db.sqlite.prepare("INSERT INTO clients(id,organization_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, orgA, `Cliente ${id}`, at, at);
  }
  db.sqlite.prepare("INSERT INTO clients(id,organization_id,name,created_at,updated_at) VALUES ('outra',?,'De outra empresa',?,?)").run(orgB, ms(-1), ms(-1));

  const agenda = await agendaFor(owner());
  const goal = agenda.goals[0];
  assert.equal(goal.current, 2, "conta só os clientes do período e da empresa");
  assert.equal(goal.target, 4);
  assert.equal(goal.percent, 50);
  assert.ok(agenda.reminders.some((item) => item.key === "meta:g1"));

  db.sqlite.prepare("INSERT INTO clients(id,organization_id,name,created_at,updated_at) VALUES ('c4',?,'Quarto',?,?)").run(orgA, ms(0), ms(0));
  db.sqlite.prepare("INSERT INTO clients(id,organization_id,name,created_at,updated_at) VALUES ('c5',?,'Quinto',?,?)").run(orgA, ms(0), ms(0));
  const batida = await agendaFor(owner());
  assert.equal(batida.goals[0].current, 4);
  assert.equal(batida.reminders.some((item) => item.key === "meta:g1"), false, "meta batida deixa de lembrar");
});

test("somente contratante ou administrador define e encerra meta", async () => {
  const negado = await goals.POST(as("colab", "colab@example.test", orgA, "/api/goals", { method: "POST",
    body: JSON.stringify({ name: "Minha meta", metric: "clients_new", targetValue: 5, periodStart: day(0), periodEnd: day(10), ownerMemberId: null }) }));
  assert.equal(negado.status, 403);
  assert.equal((await negado.json()).code, "goal_manager_required");

  const criada = await goals.POST(owner("/api/goals", { method: "POST",
    body: JSON.stringify({ name: "Clientes", metric: "clients_new", targetValue: 5, periodStart: day(0), periodEnd: day(10), ownerMemberId: null }) }));
  assert.equal(criada.status, 201);
  const { id } = await criada.json();

  const invertido = await goals.POST(owner("/api/goals", { method: "POST",
    body: JSON.stringify({ name: "Invertida", metric: "clients_new", targetValue: 5, periodStart: day(10), periodEnd: day(0), ownerMemberId: null }) }));
  assert.equal(invertido.status, 400, "período de trás para frente é recusado");

  const encerrada = await goalItem.DELETE(owner(`/api/goals/${id}`, { method: "DELETE" }), { params: Promise.resolve({ goalId: id }) });
  assert.equal(encerrada.status, 200);
  assert.equal(db.sqlite.prepare("SELECT active FROM goals WHERE id = ?").get(id).active, 0, "a meta é encerrada, não apagada");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action IN ('goal.created','goal.closed')").get().n, 2);
});

test("meta de dinheiro não vaza para quem não vê financeiro nem orçamento", async () => {
  db.sqlite.prepare("INSERT INTO goals(id,organization_id,name,metric,target_value,period_start,period_end,created_by_name,active,created_at,updated_at) VALUES ('g1',?,'Faturamento','charges_amount_cents',5000000,?,?,'Contratante',1,0,0)")
    .run(orgA, day(-5), day(5));
  db.sqlite.prepare("UPDATE members SET permissions_json = ? WHERE id = 'colab'").run(permissions({
    finance: { view: false, edit: false }, budgets: { view: false, edit: false },
  }));
  assert.equal((await agendaFor(as("colab", "colab@example.test"))).goals.length, 0);
  assert.equal((await agendaFor(owner())).goals.length, 1);
});

test("lembretes e metas não atravessam empresas", async () => {
  charge("c1", { status: "created", due: day(0) });
  db.sqlite.prepare("INSERT INTO goals(id,organization_id,name,metric,target_value,period_start,period_end,created_by_name,active,created_at,updated_at) VALUES ('g1',?,'Da empresa A','clients_new',3,?,?,'Contratante',1,0,0)")
    .run(orgA, day(-5), day(5));
  const outra = await agendaFor(as("owner-b", "owner-b@example.test", orgB));
  assert.equal(outra.reminders.length, 0);
  assert.equal(outra.goals.length, 0);
});
