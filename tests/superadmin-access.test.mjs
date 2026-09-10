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
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0superadmin-test-runtime"; }, load(id) { if (id === "\0superadmin-test-runtime") return "export const env = globalThis.__platformTestRuntime;"; } }], server: { middlewareMode: true } });
const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
const migrations = await Promise.all((await readdir(`${root}/drizzle`)).filter((file) => file.endsWith(".sql")).sort().map((file) => readFile(`${root}/drizzle/${file}`, "utf8")));

// Mesmo transporte de teste do restante da plataforma: SQLite em memória com as migrações reais.
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

const backend = await vite.ssrLoadModule("/lib/server/backend.ts");
const superadmin = await vite.ssrLoadModule("/lib/server/superadmin.ts");
const platform = await vite.ssrLoadModule("/app/api/superadmin/platform/route.ts");
const organizations = await vite.ssrLoadModule("/app/api/superadmin/organizations/route.ts");
const overview = await vite.ssrLoadModule("/app/api/superadmin/overview/route.ts");
const clients = await vite.ssrLoadModule("/app/api/clients/route.ts");
const members = await vite.ssrLoadModule("/app/api/members/route.ts");
const session = await vite.ssrLoadModule("/app/api/session/route.ts");
const onboarding = await vite.ssrLoadModule("/app/api/onboarding/route.ts");
const terms = await vite.ssrLoadModule("/app/api/terms/accept/route.ts");
const portal = await vite.ssrLoadModule("/lib/server/portal.ts");
const acceptInvitation = await vite.ssrLoadModule("/app/api/invitations/[token]/accept/route.ts");

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const adminEmail = "admin@example.test";
const secret = "test-only-shared-secret-at-least-32-characters";
let db; let cookie;

beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  for (const org of [orgA, orgB]) {
    db.sqlite.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,0,0)").run(org, org, org);
    db.sqlite.prepare("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,0,0)").run(`owner-${org}`, `owner-${org}@example.test`, "Owner");
    db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES (?,?,?,?,?,'member',?)")
      .run(org, org, `owner-${org}`, "Colaborador", `owner-${org}@example.test`, JSON.stringify({ crm: { view: true, edit: false } }));
    db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,?,?,?,'','',1)")
      .run(org, org, `owner-${org}`, `owner-${org}@example.test`, CURRENT_TERMS_VERSION);
  }
  Object.assign(runtime, { DB: db, SUPERADMIN_EMAIL: adminEmail, SUPERADMIN_PASSWORD_HASH: "test-only", SUPERADMIN_SESSION_SECRET: secret });
  cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformTestRuntime; });

function asSuperAdmin(url = "https://platform.test/api/clients", organizationId = orgA, init = {}) {
  return new Request(url, { ...init, headers: { cookie: `${cookie}; __Host-nexo-organization=${organizationId}`, "content-type": "application/json", ...init.headers } });
}
function asMember(organizationId = orgA, init = {}) {
  return new Request("https://platform.test/api/clients", { ...init, headers: {
    "oai-authenticated-user-id": `owner-${organizationId}`, "oai-authenticated-user-email": `owner-${organizationId}@example.test`,
    cookie: `__Host-nexo-organization=${organizationId}`, "content-type": "application/json", ...init.headers } });
}

test("a sessão do superadministrador abre qualquer empresa com leitura e edição totais", async () => {
  for (const organizationId of [orgA, orgB]) {
    const context = await backend.requireOrganizationContext(asSuperAdmin(undefined, organizationId));
    assert.equal(context.organization.id, organizationId);
    assert.equal(context.member.role, "superadmin");
    assert.equal(context.termsAccepted, true);
    for (const [module, grant] of Object.entries(context.member.permissions)) {
      assert.equal(grant.view, true, `${module} deveria permitir leitura`);
      assert.equal(grant.edit, true, `${module} deveria permitir edição`);
    }
    assert.doesNotThrow(() => backend.requireModulePermission(context, "finance", "edit"));
  }
});

test("escreve dados reais na empresa escolhida e registra o autor na auditoria", async () => {
  const response = await clients.POST(asSuperAdmin(undefined, orgB, { method: "POST", body: JSON.stringify({ name: "Cliente do superadmin" }) }));
  assert.equal(response.status, 201, await response.clone().text());
  const row = db.sqlite.prepare("SELECT organization_id FROM clients").get();
  assert.equal(row.organization_id, orgB);
  const audit = db.sqlite.prepare("SELECT actor_user_id FROM audit_events WHERE action='client.created'").get();
  assert.equal(audit.actor_user_id, "platform-superadmin");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM platform_audit_events WHERE action='platform.superadmin_entered'").get().n, 1);
});

test("bloqueio de acesso e assinatura pendente não impedem o superadministrador", async () => {
  await platform.POST(new Request("https://platform.test/api/superadmin/platform", { method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "access", organizationId: orgA, subject: "*", state: "blocked", until: null, reason: "Contrato suspenso", revision: 0 }) }));
  db.sqlite.prepare("INSERT INTO drap_activations(organization_id,company_id,plan_id,request_key,status,updated_at) VALUES (?,?,?,?,'pending',0)").run(orgA, "empresa-1", "mensal", "chave");
  await assert.rejects(backend.requireOrganizationContext(asMember()), { code: "platform_access_blocked" });
  const context = await backend.requireOrganizationContext(asSuperAdmin(undefined, orgA));
  assert.equal(context.organization.id, orgA);
});

test("o membro reservado da plataforma não é alcançável por um login comum com o mesmo e-mail", async () => {
  await backend.requireOrganizationContext(asSuperAdmin(undefined, orgA));
  const impostor = new Request("https://platform.test/api/clients", { headers: {
    "oai-authenticated-user-id": "outro-usuario", "oai-authenticated-user-email": adminEmail, cookie: `__Host-nexo-organization=${orgA}` } });
  await assert.rejects(backend.requireOrganizationContext(impostor), { code: "membership_required" });
});

test("a equipe da empresa e os indicadores da plataforma não contam o acesso reservado", async () => {
  await backend.requireOrganizationContext(asSuperAdmin(undefined, orgA));
  db.sqlite.prepare("UPDATE members SET permissions_json=? WHERE organization_id=? AND role='member'")
    .run(JSON.stringify({ team: { view: true, edit: false } }), orgA);
  const listed = await (await members.GET(asMember())).json();
  assert.deepEqual(listed.members.map((member) => member.role), ["member"]);
  const totals = await (await overview.GET(new Request("https://platform.test/api/superadmin/overview", { headers: { cookie } }))).json();
  assert.equal(totals.totals.members, 2);
});

test("cadastra uma empresa pelo painel e passa a operá-la imediatamente", async () => {
  const created = await organizations.POST(new Request("https://platform.test/api/superadmin/organizations", { method: "POST",
    headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Escritório Novo" }) }));
  assert.equal(created.status, 201, await created.clone().text());
  const { organization } = await created.json();
  const context = await backend.requireOrganizationContext(asSuperAdmin(undefined, organization.id));
  assert.equal(context.organization.name, "Escritório Novo");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM platform_audit_events WHERE action='platform.organization_created'").get().n, 1);
  assert.equal((await organizations.POST(new Request("https://platform.test/api/superadmin/organizations", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sem sessão" }) }))).status, 401);
});

test("a sessão lista todas as empresas e mantém o onboarding com o contratante", async () => {
  const body = await (await session.GET(asSuperAdmin("https://platform.test/api/session", orgB))).json();
  assert.equal(body.authMethod, "superadmin");
  assert.equal(body.organization.id, orgB);
  assert.equal(body.organizations.length, 2);
  assert.equal(body.member.role, "superadmin");
  const blocked = await onboarding.POST(asSuperAdmin("https://platform.test/api/onboarding", orgA, { method: "POST", body: JSON.stringify({ organizationName: "Empresa direta", acceptTerms: true }) }));
  assert.equal(blocked.status, 403);
});

test("sem empresas cadastradas, a plataforma responde vazia em vez de fabricar contexto", async () => {
  db.sqlite.exec("DELETE FROM terms_acceptances; DELETE FROM members; DELETE FROM organizations");
  await assert.rejects(backend.requireOrganizationContext(asSuperAdmin()), { code: "no_organization" });
  const body = await (await session.GET(asSuperAdmin("https://platform.test/api/session"))).json();
  assert.equal(body.platformEmpty, true);
  assert.equal(body.needsOrganization, false);
});

test("a plataforma não assina termos, não aceita convites nem vira cliente do portal", async () => {
  const accepted = await terms.POST(asSuperAdmin("https://platform.test/api/terms/accept", orgA, { method: "POST", body: JSON.stringify({ accepted: true, version: CURRENT_TERMS_VERSION }) }));
  assert.equal(accepted.status, 403);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM terms_acceptances WHERE external_user_id='platform-superadmin'").get().n, 0);

  await assert.rejects(portal.portalAccessesForUser(asSuperAdmin("https://platform.test/api/portal", orgA)), { code: "superadmin_scope" });

  db.sqlite.prepare("INSERT INTO organization_invitations(id,organization_id,email,role,permissions_json,token_hash,invited_by_email,expires_at,created_at) VALUES ('convite',?,?,'admin','{}','hash','quem',?,0)")
    .run(orgA, adminEmail, Date.now() + 86400000);
  const invited = await acceptInvitation.POST(
    asSuperAdmin("https://platform.test/api/invitations/token/accept", orgA, { method: "POST", body: JSON.stringify({ acceptTerms: true }) }),
    { params: Promise.resolve({ token: "x".repeat(40) }) },
  );
  assert.equal(invited.status, 403);
  assert.equal((await invited.json()).code, "superadmin_scope");
});
