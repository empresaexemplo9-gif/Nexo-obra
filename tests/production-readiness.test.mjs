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
