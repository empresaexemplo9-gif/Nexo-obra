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
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0diary-test-runtime"; }, load(id) { if (id === "\0diary-test-runtime") return "export const env = globalThis.__platformTestRuntime;"; } }], server: { middlewareMode: true } });
const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
const migrations = await Promise.all((await readdir(`${root}/drizzle`)).filter((file) => file.endsWith(".sql")).sort().map((file) => readFile(`${root}/drizzle/${file}`, "utf8")));

// In-memory SQLite executes the exact prepared SQL against all real migrations.
// Only the D1 transport and R2 bytes are substituted; auth, permissions, handlers and queries are real.
class D1Local {
  sqlite = new DatabaseSync(":memory:");
  failNextBatch = false;
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
    try {
      const result = statements.map((statement) => statement.execute());
      if (this.failNextBatch) { this.failNextBatch = false; throw new Error("Simulated transactional failure"); }
      this.sqlite.exec("COMMIT"); return result;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const platform = await vite.ssrLoadModule('/app/api/superadmin/platform/route.ts');
const callback = await vite.ssrLoadModule('/app/api/integrations/drap/activation/route.ts');
const backend = await vite.ssrLoadModule('/lib/server/backend.ts');
const activation = await vite.ssrLoadModule('/lib/server/activation.ts');
const superadmin = await vite.ssrLoadModule('/lib/server/superadmin.ts');
const accept = await vite.ssrLoadModule('/app/api/invitations/[token]/accept/route.ts');
const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
const secret = 'test-only-shared-secret-at-least-32-characters';
let db; let cookie;
beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of migrations) db.sqlite.exec(migration);
  for (const org of [orgA, orgB]) {
    db.sqlite.prepare('INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES (?,?,?,0,0)').run(org, org, org);
    db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role) VALUES (?,?,?,?,?,'owner')").run(org, org, 'owner', 'Owner', 'owner@example.test');
    db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,'owner','owner@example.test',?,'','',1)").run(org, org, CURRENT_TERMS_VERSION);
  }
  Object.assign(runtime, { DB: db, SUPERADMIN_EMAIL: 'admin@example.test', SUPERADMIN_PASSWORD_HASH: 'test-only', SUPERADMIN_SESSION_SECRET: secret,
    DRAP_ACTIVATION_WEBHOOK_SECRET: secret, DRAP_ACTIVATION_URL: 'https://empresa.drap.app.br/test-contract/activation', DRAP_ACTIVATION_TOKEN: 'test-only-token' });
  cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(';')[0];
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformTestRuntime; });
function req(body, headers = {}) { return new Request('https://platform.test/api/superadmin/platform', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ organizationId: orgA, ...body }) }); }
async function action(body) { const response = await platform.POST(req(body)); assert.ok(response.ok, await response.clone().text()); return response.json(); }
function user(org = orgA) { return new Request('https://platform.test/api/projects', { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.test', cookie: `__Host-nexo-organization=${org}` } }); }
async function enroll() { await action({ action: 'enroll', companyId: 'empresa-1', planId: 'mensal', confirmed: true }); return activation.activationFor(orgA); }
function event(row, overrides = {}) { return { eventId: crypto.randomUUID(), organizationId: orgA, companyId: row.company_id, planId: row.plan_id, requestKey: row.request_key,
  subscriptionId: 'subscription-1', revision: 1, status: 'active', baseMonthlyCents: 13900, monthlyCents: 20850, currency: 'BRL', interval: 'month', product: 'drap_architector', billingOwner: 'drap_empresa', ...overrides }; }
async function signed(body, { timestamp = Math.floor(Date.now() / 1000).toString(), signingSecret = secret } = {}) {
  const raw = JSON.stringify(body); const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + raw))).toString('hex');
  return new Request('https://platform.test/api/integrations/drap/activation', { method: 'POST', headers: { 'content-type': 'application/json', 'x-drap-timestamp': timestamp, 'x-drap-signature': signature }, body: raw });
}
test('only superadmin can change access or activate; foreign origins are rejected', async () => {
  for (const headers of [{ cookie: '' }, { cookie: 'invalid' }]) assert.equal((await platform.POST(req({ action: 'partner', email: 'p@example.test' }, headers))).status, 401);
  assert.equal((await platform.POST(req({ action: 'partner', email: 'p@example.test' }, { origin: 'https://attacker.test' }))).status, 403);
  assert.equal((await platform.GET(new Request(`https://platform.test/?organizationId=${orgA}`))).status, 401);
});
test('permanent company block affects existing sessions, preserves other companies, and can be restored', async () => {
  await backend.requireOrganizationContext(user());
  await action({ action: 'access', subject: '*', state: 'blocked', until: null, reason: 'Contrato suspenso', revision: 0 });
  await assert.rejects(backend.requireOrganizationContext(user()), { code: 'platform_access_blocked' });
  await backend.requireOrganizationContext(user(orgB));
  await action({ action: 'access', subject: '*', state: 'active', until: null, reason: 'Acesso restabelecido', revision: 1 });
  await backend.requireOrganizationContext(user());
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM platform_audit_events WHERE action='platform.access_changed'").get().n, 2);
});
test('temporary blocks expire; invalid deadlines and stale edits are rejected without audit', async () => {
  assert.equal((await platform.POST(req({ action: 'access', subject: '*', state: 'suspended', until: Date.now() - 10, reason: 'Prazo inválido', revision: 0 }))).status, 400);
  await action({ action: 'access', subject: 'owner@example.test', state: 'suspended', until: Date.now() + 60000, reason: 'Pausa temporária', revision: 0 });
  await assert.rejects(backend.requireOrganizationContext(user()), { code: 'platform_access_blocked' });
  assert.equal((await platform.POST(req({ action: 'access', subject: 'owner@example.test', state: 'active', until: null, reason: 'Edição atrasada', revision: 0 }))).status, 409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_audit_events').get().n, 1);
  db.sqlite.prepare('UPDATE platform_access_rules SET until=?').run(Date.now() - 1);
  await backend.requireOrganizationContext(user());
});
test('removed access cannot reenter by accepting an old invitation; records remain intact', async () => {
  const invitation = await action({ action: 'partner', email: 'partner@example.test' });
  await action({ action: 'access', subject: 'partner@example.test', state: 'removed', until: null, reason: 'Parceria encerrada', revision: 0 });
  const request = new Request('https://platform.test/accept', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'partner-id', 'oai-authenticated-user-email': 'partner@example.test' }, body: JSON.stringify({ acceptTerms: true }) });
  const response = await accept.POST(request, { params: Promise.resolve({ token: invitation.invitationPath.split('/').at(-1) }) });
  assert.equal(response.status, 403); assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM organizations').get().n, 2);
});
test('partner invitation is tenant-scoped, carries read-only partner permissions and exposes no raw token in storage', async () => {
  const result = await action({ action: 'partner', email: 'Partner@example.test' });
  const row = db.sqlite.prepare('SELECT * FROM organization_invitations').get();
  assert.equal(row.role, 'partner'); assert.equal(row.organization_id, orgA); assert.equal(row.email, 'partner@example.test');
  assert.equal(JSON.parse(row.permissions_json).team.edit, false); assert.equal(JSON.parse(row.permissions_json).projects.edit, false);
  assert.notEqual(row.token_hash, result.invitationPath.split('/').at(-1));
});
test('150% pricing uses integer centavos and rejects invalid bases', () => {
  assert.equal(activation.architectorMonthlyCents(13900), 20850); assert.equal(activation.architectorMonthlyCents(101), 152); assert.equal(activation.architectorMonthlyCents(0), 0);
  for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER, NaN]) assert.throws(() => activation.architectorMonthlyCents(value));
});
test('enrollment stays pending until Empresa confirms; callback connects financial company without creating charges locally', async () => {
  const row = await enroll(); await assert.rejects(backend.requireOrganizationContext(user()), { code: 'subscription_inactive' });
  await backend.requireOrganizationContext(user(orgB));
  const response = await callback.POST(await signed(event(row))); assert.equal(response.status, 200, await response.clone().text());
  await backend.requireOrganizationContext(user());
  const current = await activation.activationFor(orgA); assert.equal(current.monthly_cents, 20850); assert.equal(current.status, 'active');
  assert.equal(db.sqlite.prepare("SELECT external_company_id FROM integration_connections WHERE organization_id=?").get(orgA).external_company_id, 'empresa-1');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM financial_charge_requests').get().n, 0);
});
test('invalid signatures, old timestamps, altered totals and unrelated companies never activate', async () => {
  const row = await enroll(); const body = event(row);
  assert.equal((await callback.POST(await signed(body, { signingSecret: 'wrong' }))).status, 401);
  assert.equal((await callback.POST(await signed(body, { timestamp: '1600000000' }))).status, 401);
  assert.equal((await callback.POST(await signed({ ...body, monthlyCents: 13900 }))).status, 409);
  assert.equal((await callback.POST(await signed({ ...body, organizationId: orgB }))).status, 409);
  assert.equal((await callback.POST(await signed({ ...body, companyId: 'other' }))).status, 409);
  assert.equal((await activation.activationFor(orgA)).status, 'pending');
});
test('duplicate events are idempotent; conflicting IDs and stale revisions cannot overwrite status', async () => {
  const row = await enroll(); const body = event(row);
  for (let i = 0; i < 2; i++) assert.equal((await callback.POST(await signed(body))).status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM drap_activation_events').get().n, 1);
  assert.equal((await callback.POST(await signed({ ...body, status: 'suspended' }))).status, 409);
  assert.equal((await callback.POST(await signed(event(row, { revision: 2, status: 'suspended' })))).status, 200);
  assert.equal((await callback.POST(await signed(event(row)))).status, 409);
  await assert.rejects(backend.requireOrganizationContext(user()), { code: 'subscription_inactive' });
});
test('billing activation never clears a manual block and confirmed plan upgrades preserve the 50% rule', async () => {
  const row = await enroll(); await action({ action: 'access', subject: '*', state: 'blocked', until: null, reason: 'Bloqueio manual', revision: 0 });
  assert.equal((await callback.POST(await signed(event(row)))).status, 200);
  assert.equal((await callback.POST(await signed(event(row, { revision: 2, planId: 'upgrade', baseMonthlyCents: 34900, monthlyCents: 52350 })))).status, 200);
  assert.equal((await activation.activationFor(orgA)).plan_id, 'upgrade');
  await assert.rejects(backend.requireOrganizationContext(user()), { code: 'platform_access_blocked' });
});
test('timeouts reuse the same activation key and cannot falsely mark subscriptions active', async () => {
  const row = await enroll(); const realFetch = globalThis.fetch; const keys = [];
  globalThis.fetch = async (_url, init) => { keys.push(init.headers['Idempotency-Key']); throw new Error('timeout'); };
  try {
    for (let i = 0; i < 2; i++) {
      db.sqlite.prepare('UPDATE drap_activations SET last_requested_at=0').run();
      assert.equal((await platform.POST(req({ action: 'send' }))).status, 502);
    }
    assert.deepEqual(keys, [row.request_key, row.request_key]); assert.equal((await activation.activationFor(orgA)).status, 'pending');
  } finally { globalThis.fetch = realFetch; }
});
test('missing configuration and wrong hosts do not make remote requests; repeated submissions are throttled', async () => {
  await enroll(); const realFetch = globalThis.fetch; let count = 0;
  globalThis.fetch = async () => { count++; return new Response('', { status: 202 }); };
  try {
    runtime.DRAP_ACTIVATION_URL = ''; assert.equal((await platform.POST(req({ action: 'send' }))).status, 503);
    runtime.DRAP_ACTIVATION_URL = 'https://attacker.test'; assert.equal((await platform.POST(req({ action: 'send' }))).status, 503); assert.equal(count, 0);
    runtime.DRAP_ACTIVATION_URL = 'https://empresa.drap.app.br/test-contract/activation';
    assert.equal((await platform.POST(req({ action: 'send' }))).status, 200);
    assert.equal((await platform.POST(req({ action: 'send' }))).status, 429); assert.equal(count, 1);
  } finally { globalThis.fetch = realFetch; }
});
test('an existing financial company link cannot be silently replaced by activation', async () => {
  const row = await enroll();
  db.sqlite.prepare("INSERT INTO integration_connections(id,organization_id,provider,external_company_id) VALUES ('existing',?,'drap','different')").run(orgA);
  assert.equal((await callback.POST(await signed(event(row)))).status, 409);
  assert.equal((await activation.activationFor(orgA)).status, 'pending');
});
test('data and history are restricted to the selected company and responses cannot be cached', async () => {
  await action({ action: 'access', subject: '*', state: 'blocked', until: null, reason: 'Empresa A apenas', revision: 0 });
  const response = await platform.GET(new Request(`https://platform.test/?organizationId=${orgB}`, { headers: { cookie } }));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json(); assert.equal(body.rules.length, 0); assert.equal(body.history.length, 0); assert.equal(body.activation, null);
});

test('a failed transaction cannot leave access rules or subscription confirmation partially applied', async () => {
  db.failNextBatch = true;
  assert.equal((await platform.POST(req({ action: 'access', subject: '*', state: 'blocked', until: null, reason: 'Teste transacional', revision: 0 }))).status, 500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_access_rules').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_audit_events').get().n, 0);
  const row = await enroll(); db.failNextBatch = true;
  assert.equal((await callback.POST(await signed(event(row)))).status, 500);
  assert.equal((await activation.activationFor(orgA)).status, 'pending');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM drap_activation_events').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM integration_connections').get().n, 0);
});
