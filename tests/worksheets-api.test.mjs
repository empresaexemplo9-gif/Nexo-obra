import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformTestRuntime = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } },
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0worksheet-test-runtime"; }, load(id) { if (id === "\0worksheet-test-runtime") return "export const env = globalThis.__platformTestRuntime;"; } }], server: { middlewareMode: true } });
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

const list = await vite.ssrLoadModule("/app/api/worksheets/route.ts");
const item = await vite.ssrLoadModule("/app/api/worksheets/[worksheetId]/route.ts");
const data = await vite.ssrLoadModule("/app/api/worksheets/data/route.ts");
const grants = await vite.ssrLoadModule("/app/api/worksheets/[worksheetId]/grants/route.ts");
const superadmin = await vite.ssrLoadModule("/lib/server/superadmin.ts");
const sheet = await vite.ssrLoadModule("/lib/spreadsheet.ts");

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
let db; let adminCookie;

const permissions = (overrides = {}) => JSON.stringify({
  overview: { view: true, edit: true }, projects: { view: true, edit: true }, budgets: { view: true, edit: true },
  schedule: { view: true, edit: true }, diary: { view: true, edit: true }, portal: { view: true, edit: true },
  crm: { view: true, edit: true }, finance: { view: true, edit: true }, team: { view: true, edit: true },
  tasks: { view: true, edit: true }, files: { view: true, edit: true }, ...overrides,
});

beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  for (const [org, id, email] of [[orgA, "owner", "owner@example.test"], [orgB, "owner-b", "owner-b@example.test"]]) {
    db.sqlite.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,0,0)").run(org, org, org);
    db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,0,0)").run(id, email, "Contratante");
    db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES (?,?,?,?,?,'owner',?)")
      .run(org, org, id, "Contratante", email, permissions());
    db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,?,?,?,'','',1)")
      .run(org, org, id, email, CURRENT_TERMS_VERSION);
  }
  db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('colab','colab@example.test','Colaborador',0,0)").run();
  db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES ('colab',?,'colab','Colaborador','colab@example.test','member',?)")
    .run(orgA, permissions({ budgets: { view: false, edit: false } }));
  db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES ('tc',?,'colab','colab@example.test',?,'','',1)").run(orgA, CURRENT_TERMS_VERSION);
  Object.assign(runtime, { DB: db, SUPERADMIN_EMAIL: "admin@example.test", SUPERADMIN_PASSWORD_HASH: "test-only", SUPERADMIN_SESSION_SECRET: "test-only-shared-secret-at-least-32-characters" });
  adminCookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformTestRuntime; });

function as(id, email, org = orgA, path = "/api/worksheets", init = {}) {
  return new Request(`https://platform.test${path}`, { ...init, headers: {
    "oai-authenticated-user-id": id, "oai-authenticated-user-email": email,
    "content-type": "application/json", cookie: `__Host-nexo-organization=${org}`, ...init.headers } });
}
const owner = (path, init) => as("owner", "owner@example.test", orgA, path, init);
const params = (worksheetId) => ({ params: Promise.resolve({ worksheetId }) });

async function createSheet(cells = {}) {
  const response = await list.POST(owner("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Orçamento", kind: "sheet", content: { cells, body: "", widths: {} } }) }));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).worksheet;
}

test("guarda o que foi digitado e devolve o mesmo conteúdo para recalcular", async () => {
  const created = await createSheet({ A1: "12", B1: "89,90", C1: "=A1*B1" });
  assert.equal(created.revision, 1);
  const reopened = (await (await item.GET(owner(`/api/worksheets/${created.id}`), params(created.id))).json()).worksheet;
  assert.deepEqual(reopened.content.cells, { A1: "12", B1: "89,90", C1: "=A1*B1" });
  // O valor não é guardado: é recalculado pelo mesmo motor dos dois lados.
  assert.equal(sheet.evaluateSheet(reopened.content.cells).C1.value, 1078.8);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='worksheet.created'").get().n, 1);
});

test("a revisão impede que um acesso apague em silêncio o trabalho do outro", async () => {
  const created = await createSheet({ A1: "1" });
  const salvo = await item.PATCH(owner(`/api/worksheets/${created.id}`, { method: "PATCH",
    body: JSON.stringify({ content: { cells: { A1: "2" }, body: "", widths: {} }, revision: 1 }) }), params(created.id));
  assert.equal(salvo.status, 200);
  assert.equal((await salvo.json()).worksheet.revision, 2);

  const atrasado = await item.PATCH(owner(`/api/worksheets/${created.id}`, { method: "PATCH",
    body: JSON.stringify({ content: { cells: { A1: "99" }, body: "", widths: {} }, revision: 1 }) }), params(created.id));
  assert.equal(atrasado.status, 409);
  assert.equal((await atrasado.json()).code, "worksheet_conflict");
  assert.equal(JSON.parse(db.sqlite.prepare("SELECT content_json FROM worksheets").get().content_json).cells.A1, "2");
});

test("planilha de uma empresa não aparece nem abre na outra", async () => {
  const created = await createSheet({ A1: "segredo" });
  const outra = as("owner-b", "owner-b@example.test", orgB, `/api/worksheets/${created.id}`);
  assert.equal((await item.GET(outra, params(created.id))).status, 404);
  const listada = await (await list.GET(as("owner-b", "owner-b@example.test", orgB))).json();
  assert.equal(listada.worksheets.length, 0);
});

test("a listagem não carrega o conteúdo das planilhas", async () => {
  await createSheet({ A1: "conteúdo pesado" });
  const listada = await (await list.GET(owner("/api/worksheets"))).json();
  assert.equal(listada.worksheets.length, 1);
  assert.equal(listada.worksheets[0].content, undefined);
  assert.equal(listada.worksheets[0].name, "Orçamento");
});

test("só quem criou, o contratante ou um administrador exclui", async () => {
  const doColaborador = await list.POST(as("colab", "colab@example.test", orgA, "/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Do colaborador", kind: "sheet" }) }));
  const criada = (await doColaborador.json()).worksheet;

  const daEmpresa = await createSheet({ A1: "1" });
  const negado = await item.DELETE(as("colab", "colab@example.test", orgA, `/api/worksheets/${daEmpresa.id}`, { method: "DELETE" }), params(daEmpresa.id));
  assert.equal(negado.status, 403);
  assert.equal((await negado.json()).code, "worksheet_owner_required");

  assert.equal((await item.DELETE(as("colab", "colab@example.test", orgA, `/api/worksheets/${criada.id}`, { method: "DELETE" }), params(criada.id))).status, 200);
  assert.equal((await item.DELETE(owner(`/api/worksheets/${daEmpresa.id}`, { method: "DELETE" }), params(daEmpresa.id))).status, 200);
});

test("os dados reais entram já somáveis e respeitam a permissão do módulo", async () => {
  db.sqlite.prepare("INSERT INTO projects(id,organization_id,code,name,type,kind,status,phase,created_at,updated_at) VALUES ('p',?,'ARQ-001','Casa Alfa','work','work','active','execucao',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(orgA);
  db.sqlite.prepare("INSERT INTO budget_versions(id,organization_id,project_id,code,version,status) VALUES ('v',?,'p','ORC-1',1,'draft')").run(orgA);
  db.sqlite.prepare("INSERT INTO budget_items(id,budget_version_id,sort_order,description,unit,quantity,unit_cost_cents,unit_price_cents,source) VALUES ('i1','v',0,'Piso','m2',12,8990,10990,'manual')").run();
  db.sqlite.prepare("INSERT INTO budget_items(id,budget_version_id,sort_order,description,unit,quantity,unit_cost_cents,unit_price_cents,source) VALUES ('i2','v',1,'Pintura','m2',30,1500,2200,'manual')").run();

  const response = await data.GET(owner("/api/worksheets/data?source=budget&startLine=1"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rows.length, 2);
  assert.deepEqual(body.rows[0].slice(0, 6), ["", "Piso", "m2", 12, 89.9, 109.9]);
  assert.equal(body.rows[0][6], "=D2*F2", "a coluna de total já vem com a fórmula na linha certa");
  assert.equal(body.rows[1][6], "=D3*F3");

  // Colado a partir da linha 1, o total das duas linhas fecha com o banco.
  const cells = { D2: "12", F2: "109,9", G2: "=D2*F2", D3: "30", F3: "22", G3: "=D3*F3", G4: "=SOMA(G2:G3)" };
  assert.equal(sheet.evaluateSheet(cells).G4.value, 1978.8);

  const semPermissao = await data.GET(as("colab", "colab@example.test", orgA, "/api/worksheets/data?source=budget"));
  assert.equal(semPermissao.status, 403);
  const origens = await (await data.GET(as("colab", "colab@example.test", orgA, "/api/worksheets/data"))).json();
  assert.equal(origens.sources.some((source) => source.id === "budget"), false, "a origem sem permissão nem é oferecida");
});

test("recusa conteúdo fora do formato e endereços de célula inválidos", async () => {
  const invalido = await list.POST(owner("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Ruim", content: { cells: { "linha 1": "=1" }, body: "", widths: {} } }) }));
  assert.equal(invalido.status, 400);
  const extra = await list.POST(owner("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Ruim", content: { cells: {}, body: "", widths: {}, script: "alert(1)" } }) }));
  assert.equal(extra.status, 400);
  assert.equal((await item.GET(owner("/api/worksheets/nao-e-uuid"), params("nao-e-uuid"))).status, 404);
});

function asAdmin(path = "/api/worksheets", init = {}) {
  return new Request(`https://platform.test${path}`, { ...init, headers: {
    cookie: `${adminCookie}; __Host-nexo-organization=${orgA}`, "content-type": "application/json", ...init.headers } });
}
async function analysisSheet() {
  const response = await list.POST(asAdmin("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Saúde financeira", kind: "analysis" }) }));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).worksheet;
}

test("a planilha de saúde financeira nasce restrita e só o superadmin cria", async () => {
  const doContratante = await list.POST(owner("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Tentativa", kind: "analysis" }) }));
  assert.equal(doContratante.status, 403);
  assert.equal((await doContratante.json()).code, "analysis_superadmin_only");

  const criada = await analysisSheet();
  assert.equal(criada.visibility, "restricted");
  assert.equal(db.sqlite.prepare("SELECT visibility FROM worksheets WHERE id = ?").get(criada.id).visibility, "restricted");
});

test("sem liberação a planilha restrita não aparece na lista nem abre", async () => {
  const criada = await analysisSheet();
  const listadaPeloDono = await (await list.GET(owner("/api/worksheets"))).json();
  assert.equal(listadaPeloDono.worksheets.some((item) => item.id === criada.id), false,
    "nem o contratante da empresa vê antes de ser liberado");
  const aberta = await item.GET(owner(`/api/worksheets/${criada.id}`), params(criada.id));
  assert.equal(aberta.status, 404, "responde como inexistente, sem revelar que existe");

  const listadaPeloAdmin = await (await list.GET(asAdmin())).json();
  assert.equal(listadaPeloAdmin.worksheets.some((item) => item.id === criada.id), true);
  assert.equal(listadaPeloAdmin.canGovern, true);
});

test("liberação de leitura deixa ver mas não salvar", async () => {
  const criada = await analysisSheet();
  const liberada = await grants.POST(asAdmin(`/api/worksheets/${criada.id}/grants`, { method: "POST",
    body: JSON.stringify({ memberId: "colab", level: "view" }) }), params(criada.id));
  assert.equal(liberada.status, 200, await liberada.clone().text());

  const colaborador = as("colab", "colab@example.test", orgA, `/api/worksheets/${criada.id}`);
  const aberta = await item.GET(colaborador, params(criada.id));
  assert.equal(aberta.status, 200);
  assert.equal((await aberta.json()).access.canEdit, false);

  const salvar = await item.PATCH(as("colab", "colab@example.test", orgA, `/api/worksheets/${criada.id}`, { method: "PATCH",
    body: JSON.stringify({ content: { cells: { A1: "1" }, body: "", widths: {}, formats: {}, bold: [], analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20 } }, revision: 1 }) }), params(criada.id));
  assert.equal(salvar.status, 403);
  assert.equal((await salvar.json()).code, "worksheet_read_only");
});

test("liberação de edição deixa salvar, e revogar fecha de novo", async () => {
  const criada = await analysisSheet();
  await grants.POST(asAdmin(`/api/worksheets/${criada.id}/grants`, { method: "POST",
    body: JSON.stringify({ memberId: "colab", level: "edit" }) }), params(criada.id));

  const salvar = await item.PATCH(as("colab", "colab@example.test", orgA, `/api/worksheets/${criada.id}`, { method: "PATCH",
    body: JSON.stringify({ content: { cells: { A1: "10" }, body: "", widths: {}, formats: {}, bold: [], analysis: { headerRow: 0, roles: { A: "receita" }, targetMarginPercent: 25 } }, revision: 1 }) }), params(criada.id));
  assert.equal(salvar.status, 200, await salvar.clone().text());
  const guardada = JSON.parse(db.sqlite.prepare("SELECT content_json FROM worksheets WHERE id = ?").get(criada.id).content_json);
  assert.equal(guardada.analysis.targetMarginPercent, 25, "a meta de margem é guardada com a planilha");
  assert.equal(guardada.analysis.roles.A, "receita");

  await grants.POST(asAdmin(`/api/worksheets/${criada.id}/grants`, { method: "POST",
    body: JSON.stringify({ memberId: "colab", level: "none" }) }), params(criada.id));
  assert.equal((await item.GET(as("colab", "colab@example.test", orgA, `/api/worksheets/${criada.id}`), params(criada.id))).status, 404);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM worksheet_grants").get().n, 0);
});

test("só o superadmin lê e altera a lista de liberações, e cada mudança fica na auditoria", async () => {
  const criada = await analysisSheet();
  assert.equal((await grants.GET(owner(`/api/worksheets/${criada.id}/grants`), params(criada.id))).status, 403);
  assert.equal((await grants.POST(owner(`/api/worksheets/${criada.id}/grants`, { method: "POST",
    body: JSON.stringify({ memberId: "colab", level: "edit" }) }), params(criada.id))).status, 403);

  const lista = await (await grants.GET(asAdmin(`/api/worksheets/${criada.id}/grants`), params(criada.id))).json();
  assert.equal(lista.members.every((member) => member.level === "none"), true);
  assert.equal(lista.members.some((member) => member.role === "superadmin"), false);

  await grants.POST(asAdmin(`/api/worksheets/${criada.id}/grants`, { method: "POST",
    body: JSON.stringify({ memberId: "colab", level: "view" }) }), params(criada.id));
  await grants.POST(asAdmin(`/api/worksheets/${criada.id}/grants`, { method: "POST",
    body: JSON.stringify({ memberId: "colab", level: "none" }) }), params(criada.id));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='worksheet.access_granted'").get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='worksheet.access_revoked'").get().n, 1);
});

test("nem o contratante exclui uma planilha de saúde financeira", async () => {
  const criada = await analysisSheet();
  await grants.POST(asAdmin(`/api/worksheets/${criada.id}/grants`, { method: "POST",
    body: JSON.stringify({ memberId: orgA, level: "edit" }) }), params(criada.id));
  const negado = await item.DELETE(owner(`/api/worksheets/${criada.id}`, { method: "DELETE" }), params(criada.id));
  assert.equal(negado.status, 403);
  assert.equal((await negado.json()).code, "analysis_superadmin_only");
  assert.equal((await item.DELETE(asAdmin(`/api/worksheets/${criada.id}`, { method: "DELETE" }), params(criada.id))).status, 200);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM worksheet_grants").get().n, 0, "as liberações saem junto");
});

test("a planilha comum continua aberta à empresa como antes", async () => {
  const comum = await createSheet({ A1: "1" });
  assert.equal(comum.visibility, "organization");
  const doColaborador = await item.GET(as("colab", "colab@example.test", orgA, `/api/worksheets/${comum.id}`), params(comum.id));
  assert.equal(doColaborador.status, 200);
  assert.equal((await doColaborador.json()).access.canEdit, true);
});

test("criar por modelo monta o conteúdo no servidor, com fórmulas e papéis prontos", async () => {
  const response = await list.POST(owner("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Orçamento da Casa Alfa", kind: "sheet", templateId: "orcamento-obra" }) }));
  assert.equal(response.status, 201, await response.clone().text());
  const { worksheet } = await response.json();

  assert.equal(worksheet.content.cells.A1, "Etapa");
  assert.equal(worksheet.content.cells.F2, '=SE(D2="";"";D2*E2)');
  assert.equal(worksheet.content.analysis.roles.H, "receita");
  assert.equal(worksheet.content.analysis.roles.F, "custo");
  assert.equal(worksheet.content.analysis.targetMarginPercent, 25);
  assert.equal(worksheet.content.analysis.ignoreRows.length, 1, "a linha de totais já nasce fora da leitura");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='worksheet.created'").get().n, 1);
});

test("um modelo que não existe é recusado e o conteúdo nunca vem do navegador", async () => {
  const inexistente = await list.POST(owner("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "X", kind: "sheet", templateId: "nao-existe" }) }));
  assert.equal(inexistente.status, 404);
  assert.equal((await inexistente.json()).code, "template_not_found");

  // Mesmo mandando conteúdo junto, o modelo do servidor é o que vale.
  const forjada = await list.POST(owner("/api/worksheets", { method: "POST",
    body: JSON.stringify({ name: "Forjada", kind: "sheet", templateId: "fluxo-de-caixa",
      content: { cells: { A1: "invadido" }, body: "", widths: {}, formats: {}, bold: [],
        analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [] } } }) }));
  assert.equal(forjada.status, 201);
  assert.equal((await forjada.json()).worksheet.content.cells.A1, "Data");
});
