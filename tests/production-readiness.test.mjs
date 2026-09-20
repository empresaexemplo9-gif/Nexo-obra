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
const migrations = await Promise.all((await readdir(`${root}/drizzle`)).filter((file) => file.endsWith(".sql")).sort().map((file) => readFile(`${root}/drizzle/${file}`, "utf8")));
const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
const crm = await vite.ssrLoadModule("/app/api/crm/route.ts");
const crmItem = await vite.ssrLoadModule("/app/api/crm/[opportunityId]/route.ts");
const budgets = await vite.ssrLoadModule("/app/api/budgets/route.ts");
const budgetItems = await vite.ssrLoadModule("/app/api/budgets/[budgetId]/items/route.ts");
const budgetItem = await vite.ssrLoadModule("/app/api/budgets/[budgetId]/route.ts");
const budgetCopy = await vite.ssrLoadModule("/app/api/budgets/[budgetId]/copy/route.ts");
const budgetReport = await vite.ssrLoadModule("/app/api/budgets/[budgetId]/report/route.ts");
const tasks = await vite.ssrLoadModule("/app/api/tasks/route.ts");
const taskItem = await vite.ssrLoadModule("/app/api/tasks/[taskId]/route.ts");
const projectItem = await vite.ssrLoadModule("/app/api/projects/[projectId]/route.ts");
const projects = await vite.ssrLoadModule("/app/api/projects/route.ts");
const schedule = await vite.ssrLoadModule("/app/api/schedule/route.ts");
const permissions = await vite.ssrLoadModule("/lib/permissions.ts");

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
        return { success: true, results, meta: { changes: Number(sqlite.prepare("SELECT changes() AS n").get().n) } };
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

const orgId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
let db;

beforeEach(() => {
  db?.sqlite.close();
  db = new D1Local();
  db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  db.sqlite.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,0,0)").run(orgId, "Profissional", "profissional");
  db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('owner','owner@example.test','Titular',0,0)").run();
  db.sqlite.prepare("INSERT INTO organization_members(id,organization_id,user_id,role,created_at) VALUES (?,?,?,'owner',0)").run(memberId, orgId, "owner");
  db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role) VALUES (?,?,?,?,?,'owner')").run(memberId, orgId, "owner", "Titular", "owner@example.test");
  db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,'owner','owner@example.test',?,'','',1)").run(crypto.randomUUID(), orgId, CURRENT_TERMS_VERSION);
  db.sqlite.prepare("INSERT INTO clients(id,organization_id,name,email,phone,document,created_at,updated_at) VALUES (?,?,?,'cliente@example.test',NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, orgId, "Cliente Real");
  Object.assign(runtime, { DB: db, TRUST_IDENTITY_HEADERS: "true" });
});

after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

function request(path, method = "GET", body) {
  return new Request(`https://platform.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "oai-authenticated-user-id": "owner",
      "oai-authenticated-user-email": "owner@example.test",
      cookie: `__Host-nexo-organization=${orgId}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response) {
  const payload = await response.clone().json().catch(() => ({}));
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function createProject(code = "REV-001") {
  const id = crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO projects (id,organization_id,client_id,code,name,type,kind,phase,stage,status,progress,progress_percent,budget_cents,created_at,updated_at) VALUES (?,?,?,?,?,'project','project','briefing','briefing','active',0,0,0,0,0)")
    .run(id, orgId, clientId, code, "Projeto revisão");
  return id;
}

test("tarefas recusam ciclos, dependências externas ao projeto e datas invertidas", async () => {
  const projectId = createProject(), other = createProject("REV-002");
  const a = (await json(await tasks.POST(request("/api/tasks", "POST", { projectId, title: "Primeira tarefa", startsAt: "2026-09-20T10:00:00Z", dueAt: "2026-09-21T10:00:00Z" })))).task;
  const b = (await json(await tasks.POST(request("/api/tasks", "POST", { projectId, title: "Segunda tarefa", parentTaskId: a.id })))).task;
  const patch = body => taskItem.PATCH(request(`/api/tasks/${a.id}`, "PATCH", body), { params: Promise.resolve({ taskId: a.id }) });
  const cycle = await patch({ parentTaskId: b.id }); assert.equal(cycle.status, 400); assert.equal((await cycle.json()).code, "dependency_cycle");
  assert.equal((await patch({ dueAt: "2026-09-19T10:00:00Z" })).status, 400);
  assert.equal((await patch({ projectId: other })).status, 400);
  assert.equal((await tasks.POST(request("/api/tasks", "POST", { projectId: other, title: "Vínculo inválido", parentTaskId: a.id }))).status, 400);
  assert.equal((await patch({ status: "done" })).status, 200);
  assert.equal((await patch({ status: "todo" })).status, 200);
  assert.equal(db.sqlite.prepare("SELECT completed_at FROM tasks WHERE id=?").get(a.id).completed_at, null);
});

test("projeto valida atualização parcial das datas sem apagar os dados existentes", async () => {
  const projectId = createProject();
  const patch = body => projectItem.PATCH(request(`/api/projects/${projectId}`, "PATCH", body), { params: Promise.resolve({ projectId }) });
  assert.equal((await patch({ startDate: "2026-09-20", targetDate: "2026-09-30" })).status, 200);
  assert.equal((await patch({ targetDate: "2026-09-19" })).status, 400);
  assert.equal(db.sqlite.prepare("SELECT target_date FROM projects WHERE id=?").get(projectId).target_date, "2026-09-30");
  assert.equal((await projects.POST(request("/api/projects", "POST", { code: "INVALID", name: "Data inválida", kind: "work", startDate: "2026-10-01", targetDate: "2026-09-30" }))).status, 400);
});

test("leitura independente do cronograma preserva restrições das tarefas e do orçamento", async () => {
  const projectId = createProject();
  await json(await tasks.POST(request("/api/tasks", "POST", { projectId, title: "Entrega planejada", description: "Descrição privada" })));
  const matrix = Object.fromEntries(permissions.permissionModules.map(key => [key, { view: key === "schedule", edit: false }]));
  db.sqlite.prepare("UPDATE members SET role='partner', permissions_json=? WHERE id=?").run(JSON.stringify(matrix), memberId);
  const response = await json(await schedule.GET(request("/api/schedule")));
  assert.equal(response.tasks.length, 1); assert.equal(response.tasks[0].title, "Entrega planejada");
  assert.ok(!Object.hasOwn(response.tasks[0], "description")); assert.ok(!Object.hasOwn(response.tasks[0], "assigneeMemberId"));
  assert.equal((await tasks.GET(request("/api/tasks"))).status, 403);
  const context = { params: Promise.resolve({ budgetId: crypto.randomUUID() }) };
  assert.equal((await budgetCopy.POST(request("/api/budgets/copy", "POST"), context)).status, 403);
  assert.equal((await budgetReport.GET(request("/api/budgets/report"), context)).status, 403);
});

test("cópia de orçamento preserva original e relatório escapa texto fornecido", async () => {
  const projectId = createProject();
  const original = (await json(await budgets.POST(request("/api/budgets", "POST", { projectId, code: "REV-ORC" })))).budget;
  const ctx = { params: Promise.resolve({ budgetId: original.id }) };
  await json(await budgetItems.POST(request("/api/budgets/items", "POST", { items: [{ description: '<script>alert(1)</script>', unit: "un", quantity: 2, unitCostCents: 1000, source: "manual" }] }), ctx));
  await json(await budgetItem.PATCH(request("/api/budgets/item", "PATCH", { status: "sent" }), ctx));
  const copy = (await json(await budgetCopy.POST(request("/api/budgets/copy", "POST"), ctx))).budget;
  assert.equal(copy.version, 2); assert.equal(copy.status, "draft"); assert.equal(copy.itemCount, 1); assert.equal(copy.totalCents, 2000);
  assert.equal(db.sqlite.prepare("SELECT status FROM budget_versions WHERE id=?").get(original.id).status, "sent");
  const report = await budgetReport.GET(request("/api/budgets/report"), ctx);
  const html = await report.text(); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/); assert.match(html, /20,00/);
  assert.match(report.headers.get("Content-Security-Policy"), /default-src 'none'/);
  const absent = { params: Promise.resolve({ budgetId: crypto.randomUUID() }) };
  assert.equal((await budgetCopy.POST(request("/api/budgets/copy", "POST"), absent)).status, 404);
  assert.equal((await budgetReport.GET(new Request("https://platform.test/api/budgets/report"), ctx)).status, 401);
});

test("cópia mantém hierarquia fora da ordem de exibição e isola outra empresa", async () => {
  const original = (await json(await budgets.POST(request("/api/budgets", "POST", { projectId: createProject(), code: "REV-HIER" })))).budget;
  const ctx = { params: Promise.resolve({ budgetId: original.id }) };
  await json(await budgetItems.POST(request("/api/budgets/items", "POST", { items: [{ description: "Pai", quantity: 1, unitCostCents: 100 }, { description: "Filho", quantity: 2, unitCostCents: 50 }] }), ctx));
  const rows = db.sqlite.prepare("SELECT id,description FROM budget_items WHERE budget_version_id=?").all(original.id);
  const parent = rows.find(row => row.description === "Pai"), child = rows.find(row => row.description === "Filho");
  db.sqlite.prepare("UPDATE budget_items SET parent_item_id=?,sort_order=-1 WHERE id=?").run(parent.id, child.id);
  const copy = (await json(await budgetCopy.POST(request("/api/budgets/copy", "POST"), ctx))).budget;
  const copied = db.sqlite.prepare("SELECT id,parent_item_id,description FROM budget_items WHERE budget_version_id=?").all(copy.id);
  assert.equal(copied.find(row => row.description === "Filho").parent_item_id, copied.find(row => row.description === "Pai").id);
  assert.notEqual(copied.find(row => row.description === "Pai").id, parent.id);
  const otherOrg = crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,0,0)").run(otherOrg, "Outra empresa", otherOrg);
  db.sqlite.prepare("UPDATE budget_versions SET organization_id=? WHERE id=?").run(otherOrg, original.id);
  assert.equal((await budgetCopy.POST(request("/api/budgets/copy", "POST"), ctx)).status, 404);
  assert.equal((await budgetReport.GET(request("/api/budgets/report"), ctx)).status, 404);
});

test("CRM cria oportunidade e converte para projeto sem recadastrar cliente", async () => {
  const created = await json(await crm.POST(request("/api/crm", "POST", {
    clientId,
    title: "Residência Jardim",
    stage: "proposal",
    estimatedValueCents: 25000000,
    probabilityPercent: 65,
    ownerMemberId: memberId,
    nextAction: "Apresentar proposta",
    nextActionAt: "2026-09-20T14:00:00-03:00",
  })));
  assert.equal(created.opportunity.clientId, clientId);
  assert.equal(created.opportunity.stage, "proposal");

  const converted = await json(await crmItem.POST(request(`/api/crm/${created.opportunity.id}`, "POST", {
    code: "ARQ-001",
    projectName: "Residência Jardim",
    kind: "project",
    targetDate: "2027-02-28",
  }), { params: Promise.resolve({ opportunityId: created.opportunity.id }) }));

  const project = db.sqlite.prepare("SELECT client_id, code, name, type, kind, budget_cents FROM projects WHERE id=?").get(converted.projectId);
  assert.equal(project.client_id, clientId);
  assert.equal(project.code, "ARQ-001");
  assert.equal(project.type, "project");
  assert.equal(project.kind, "project");
  assert.equal(Number(project.budget_cents), 25000000);
  const opportunity = db.sqlite.prepare("SELECT stage, probability_percent, won_project_id FROM crm_opportunities WHERE id=?").get(created.opportunity.id);
  assert.equal(opportunity.stage, "won");
  assert.equal(Number(opportunity.probability_percent), 100);
  assert.equal(opportunity.won_project_id, converted.projectId);
});

test("orçamento enviado fica imutável e exige nova versão para alterar itens ou margem", async () => {
  const projectId = crypto.randomUUID();
  db.sqlite.prepare(`INSERT INTO projects (
    id,organization_id,client_id,code,name,type,kind,status,stage,phase,progress,progress_percent,
    owner_member_id,starts_at,start_date,deadline_at,target_date,budget_cents,drap_cost_center_id,external_financial_cost_center_id,created_at,updated_at
  ) VALUES (?,?,?,?,?,'project','project','active','briefing','briefing',0,0,?,NULL,NULL,NULL,NULL,0,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(projectId, orgId, clientId, "ARQ-002", "Casa Azul", memberId);

  const created = await json(await budgets.POST(request("/api/budgets", "POST", { projectId, code: "ORC-001", bdiPercent: 10, marginPercent: 20 })));
  await json(await budgetItems.POST(request(`/api/budgets/${created.budget.id}/items`, "POST", { items: [{ description: "Projeto executivo", unit: "un", quantity: 1, unitCostCents: 100000, source: "manual" }] }), { params: Promise.resolve({ budgetId: created.budget.id }) }));
  const sent = await json(await budgetItem.PATCH(request(`/api/budgets/${created.budget.id}`, "PATCH", { status: "sent" }), { params: Promise.resolve({ budgetId: created.budget.id }) }));
  assert.equal(sent.budget.status, "sent");

  const alterItem = await budgetItems.POST(request(`/api/budgets/${created.budget.id}/items`, "POST", { items: [{ description: "Alteração silenciosa", quantity: 1, unit: "un", unitCostCents: 1 }] }), { params: Promise.resolve({ budgetId: created.budget.id }) });
  assert.equal(alterItem.status, 409);
  assert.equal((await alterItem.json()).code, "budget_locked");

  const alterMargin = await budgetItem.PATCH(request(`/api/budgets/${created.budget.id}`, "PATCH", { marginPercent: 35 }), { params: Promise.resolve({ budgetId: created.budget.id }) });
  assert.equal(alterMargin.status, 409);
  assert.equal((await alterMargin.json()).code, "budget_locked");
});
