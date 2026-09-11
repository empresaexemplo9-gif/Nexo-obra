import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
// Estes testes autenticam pelos cabeçalhos da borda; o modo precisa ser declarado,
// porque fora de uma borda que os sobrescreva eles são ignorados por padrão.
runtime.TRUST_IDENTITY_HEADERS = "true";
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } },
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0diary-test-runtime"; }, load(id) { if (id === "\0diary-test-runtime") return "export const env = globalThis.__platformEnvOverride;"; } }], server: { middlewareMode: true } });
const list = await vite.ssrLoadModule("/app/api/diary/route.ts");
const upload = await vite.ssrLoadModule("/app/api/diary/[entryId]/photos/route.ts");
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
const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const projectA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const users = {
  owner: { id: "owner-a", email: "owner-a@example.test", org: orgA, role: "owner", permissions: "{}" },
  other: { id: "owner-b", email: "owner-b@example.test", org: orgB, role: "owner", permissions: "{}" },
  reader: { id: "reader-a", email: "reader@example.test", org: orgA, role: "member", permissions: JSON.stringify({ diary: { view: true, edit: false } }) },
  denied: { id: "denied-a", email: "denied@example.test", org: orgA, role: "member", permissions: "{}" },
  editor: { id: "editor-a", email: "editor@example.test", org: orgA, role: "member", permissions: JSON.stringify({ diary: { view: true, edit: true } }) },
};
let db;
let bytes;
beforeEach(() => {
  db?.sqlite.close();
  db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  for (const [id, name] of [[orgA, "Empresa A"], [orgB, "Empresa B"]]) db.sqlite.prepare("INSERT INTO organizations(id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 0, 0)").run(id, name, id);
  for (const person of Object.values(users)) {
    db.sqlite.prepare("INSERT INTO users(id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, 0, 0)").run(person.id, person.email, person.id);
    db.sqlite.prepare("INSERT INTO members(id, organization_id, external_user_id, name, email, role, permissions_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(person.id, person.org, person.id, person.id, person.email, person.role, person.permissions);
    db.sqlite.prepare("INSERT INTO terms_acceptances(id, organization_id, external_user_id, email, terms_version, ip_hash, user_agent_hash, accepted_at) VALUES (?, ?, ?, ?, ?, '', '', 1)").run(person.id, person.org, person.id, person.email, CURRENT_TERMS_VERSION);
  }
  for (const [id, org, name] of [[projectA, orgA, "Obra A"], [projectB, orgB, "Obra B"]]) db.sqlite.prepare("INSERT INTO projects(id, organization_id, code, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, 'work', 0, 0)").run(id, org, name, name);
  bytes = new Map();
  runtime.DB = db;
  runtime.FILES = { async put(key, value) { bytes.set(key, value); }, async get(key) { return bytes.has(key) ? { body: new Response(bytes.get(key)).body } : null; }, async delete(key) { bytes.delete(key); } };
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

function request(path = "/api/diary", { user = "owner", method = "GET", json, body, headers = {} } = {}) {
  const identity = user ? users[user] : null;
  return new Request(`https://diary.test${path}`, { method, headers: { ...(identity ? { "oai-authenticated-user-id": identity.id, "oai-authenticated-user-email": identity.email } : {}), ...(json ? { "content-type": "application/json" } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
}
const parameters = (entryId, photoId) => ({ params: Promise.resolve({ entryId, photoId }) });
function input(overrides = {}) { return { id: crypto.randomUUID(), projectId: projectA, entryDate: "2026-09-06", weather: "clear", workforceCount: 7, summary: "Execução da alvenaria no térreo.", blockers: "", occurrenceType: "none", ...overrides }; }
async function create(overrides = {}, user = "owner") {
  const body = input(overrides);
  const response = await list.POST(request("/api/diary", { method: "POST", user, json: body }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return (await response.json()).entry;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1cAAAAASUVORK5CYII=", "base64");
function photoForm({ id = crypto.randomUUID(), contents = png, type = "image/png", caption = "Parede do térreo" } = {}) {
  const form = new FormData(); form.append("id", id); form.append("photo", new Blob([contents], { type }), "obra.png"); form.append("caption", caption); return form;
}


const accessRoutes = await vite.ssrLoadModule('/app/api/portal-management/access/route.ts');
const changeAccess = await vite.ssrLoadModule('/app/api/portal-management/access/[accessId]/route.ts');
const inviteRoutes = await vite.ssrLoadModule('/app/api/portal/invitations/[token]/route.ts');
const itemRoutes = await vite.ssrLoadModule('/app/api/portal-management/items/route.ts');
const clientRoutes = await vite.ssrLoadModule('/app/api/portal/access/[accessId]/route.ts');
const decisionRoutes = await vite.ssrLoadModule('/app/api/portal/access/[accessId]/items/[itemId]/route.ts');
const withdrawRoutes = await vite.ssrLoadModule('/app/api/portal-management/items/[itemId]/route.ts');
const photoRoutes = await vite.ssrLoadModule('/app/api/portal/access/[accessId]/items/[itemId]/photos/[photoId]/route.ts');
const portalListing = await vite.ssrLoadModule('/app/api/portal/route.ts');
const params = (values) => ({ params: Promise.resolve(values) });
function customer(method = 'GET', json, email = 'client@example.test', uid = 'client-id') {
  return request('/api/portal', { user: null, method, json, headers: { 'oai-authenticated-user-id': uid, 'oai-authenticated-user-email': email } });
}
test('platform company block protects portal content, listing and decisions without revoking the client record', async () => {
  const invitation = await invited(); await activate(invitation); const item = await published(invitation.access.id);
  db.sqlite.prepare("INSERT INTO platform_access_rules(organization_id,subject,state,reason,updated_at) VALUES (?,'*','blocked','Bloqueio administrativo',?)").run(orgA, Date.now());
  assert.equal((await clientRoutes.GET(customer(), params({ accessId: invitation.access.id }))).status, 403);
  assert.equal((await decisionRoutes.POST(customer('POST', { id: crypto.randomUUID(), choice: 'approved', comment: 'Confirmo', confirmed: true }), params({ accessId: invitation.access.id, itemId: item.id }))).status, 403);
  const listing = await portalListing.GET(customer()); assert.equal(listing.status, 200); assert.equal((await listing.json()).accesses.length, 0);
  assert.equal(db.sqlite.prepare('SELECT status FROM client_portal_access WHERE id=?').get(invitation.access.id).status, 'active');
});
async function invited() {
  const response = await accessRoutes.POST(request('/api/portal-management/access', { method: 'POST', json: { projectId: projectA, name: 'Cliente A', email: 'client@example.test', viewProgress: true, canApprove: true } }));
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json(); return { ...result, token: result.invitationUrl.split('/').at(-1) };
}
async function activate(invitation) {
  const response = await inviteRoutes.POST(customer('POST', { accepted: true, version: CURRENT_TERMS_VERSION }), params({ token: invitation.token }));
  assert.equal(response.status, 200, await response.clone().text());
}
async function published(accessId, extras = {}) {
  const payload = { id: crypto.randomUUID(), accessId, kind: 'approval', title: 'Aprovar acabamento', body: 'Revestimento selecionado para o térreo.', ...extras };
  const response = await itemRoutes.POST(request('/api/portal-management/items', { method: 'POST', json: payload }));
  assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).item;
}
test('portal rejects anonymous users, unrelated tenants, forged origins and secondary access managers', async () => {
  assert.equal((await accessRoutes.GET(request('/', { user: null }))).status, 401);
  assert.equal((await accessRoutes.GET(request('/', { user: 'denied' }))).status, 403);
  const invitation = await invited();
  assert.equal((await itemRoutes.GET(request('/?accessId=' + invitation.access.id, { user: 'other' }))).status, 404);
  assert.equal((await inviteRoutes.GET(customer('GET', undefined, 'wrong@example.test'), params({ token: invitation.token }))).status, 403);
  assert.equal((await changeAccess.PATCH(request('/', { method: 'PATCH', headers: { origin: 'https://attacker.test' }, json: { revision: 1, action: 'revoke' } }), params({ accessId: invitation.access.id }))).status, 403);
  db.sqlite.prepare('UPDATE members SET permissions_json = ? WHERE id = ?').run(JSON.stringify({ portal: { view: true, edit: true }, projects: { view: true, edit: false } }), 'editor-a');
  assert.equal((await accessRoutes.POST(request('/', { user: 'editor', method: 'POST', json: {} }))).status, 403);
});
test('invited client activates only its project without gaining organization membership; approval is immutable and idempotent', async () => {
  const invitation = await invited(); await activate(invitation);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM members WHERE external_user_id = ?').get('client-id').n, 0);
  const item = await published(invitation.access.id);
  const view = await clientRoutes.GET(customer(), params({ accessId: invitation.access.id }));
  assert.equal(view.status, 200); assert.equal(view.headers.get('cache-control'), 'private, no-store');
  const body = await view.json(); assert.equal(body.items.length, 1); assert.equal(body.progress.progressPercent, 0);
  assert.equal(body.progress.budgetCents, undefined);
  assert.equal((await clientRoutes.GET(customer('GET', undefined, 'other@test.example', 'other-id'), params({ accessId: invitation.access.id }))).status, 404);
  const decision = { id: crypto.randomUUID(), choice: 'approved', comment: 'Conforme apresentado.', confirmed: true };
  for (let i = 0; i < 2; i++) assert.equal((await decisionRoutes.POST(customer('POST', decision), params({ accessId: invitation.access.id, itemId: item.id }))).status, 200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM client_portal_decisions').get().n, 1);
  assert.equal((await withdrawRoutes.PATCH(request('/', { method: 'PATCH', json: { accessId: invitation.access.id, reason: 'Alteração indevida' } }), params({ itemId: item.id }))).status, 409);
  assert.equal((await decisionRoutes.POST(customer('POST', { ...decision, id: crypto.randomUUID(), choice: 'changes_requested' }), params({ accessId: invitation.access.id, itemId: item.id }))).status, 409);
});
test('revocation and permission changes immediately block client reads and decisions', async () => {
  const invitation = await invited(); await activate(invitation); const item = await published(invitation.access.id);
  let response = await changeAccess.PATCH(request('/', { method: 'PATCH', json: { revision: 2, action: 'permissions', viewProgress: false, canApprove: false } }), params({ accessId: invitation.access.id }));
  assert.equal(response.status, 200);
  const view = await (await clientRoutes.GET(customer(), params({ accessId: invitation.access.id }))).json(); assert.equal(view.progress, null);
  assert.equal((await decisionRoutes.POST(customer('POST', { id: crypto.randomUUID(), choice: 'approved', comment: '', confirmed: true }), params({ accessId: invitation.access.id, itemId: item.id }))).status, 403);
  response = await changeAccess.PATCH(request('/', { method: 'PATCH', json: { revision: 3, action: 'revoke' } }), params({ accessId: invitation.access.id })); assert.equal(response.status, 200);
  assert.equal((await clientRoutes.GET(customer(), params({ accessId: invitation.access.id }))).status, 404);
});
test('expired invitations and missing terms cannot expose client publications', async () => {
  const invitation = await invited();
  db.sqlite.prepare('UPDATE client_portal_access SET expires_at = 1 WHERE id = ?').run(invitation.access.id);
  assert.equal((await inviteRoutes.POST(customer('POST', { accepted: true, version: CURRENT_TERMS_VERSION }), params({ token: invitation.token }))).status, 410);
  db.sqlite.prepare('UPDATE client_portal_access SET expires_at = ? WHERE id = ?').run(Date.now() + 100000, invitation.access.id);
  await activate(invitation);
  db.sqlite.prepare('DELETE FROM client_portal_acceptances').run();
  assert.equal((await clientRoutes.GET(customer(), params({ accessId: invitation.access.id }))).status, 403);
});
test('selected diary photos are project scoped, private, and disappear after withdrawal', async () => {
  const invitation = await invited(); await activate(invitation);
  const diary = await create(); const photoId = crypto.randomUUID();
  const uploaded = await upload.POST(request('/', { method: 'POST', body: photoForm({ id: photoId }) }), parameters(diary.id)); assert.equal(uploaded.status, 201);
  const item = await published(invitation.access.id, { kind: 'update', sourceDiaryId: diary.id, photoIds: [photoId] });
  const pp = params({ accessId: invitation.access.id, itemId: item.id, photoId });
  assert.equal((await photoRoutes.GET(customer(), pp)).status, 200);
  assert.equal((await photoRoutes.GET(customer('GET', undefined, 'wrong@example.test', 'wrong'), pp)).status, 404);
  assert.equal((await photoRoutes.GET(customer(), params({ accessId: invitation.access.id, itemId: item.id, photoId: crypto.randomUUID() }))).status, 404);
  assert.equal((await withdrawRoutes.PATCH(request('/', { method: 'PATCH', json: { accessId: invitation.access.id, reason: 'Registro substituído por atualização.' } }), params({ itemId: item.id }))).status, 200);
  assert.equal((await photoRoutes.GET(customer(), pp)).status, 404);
});
