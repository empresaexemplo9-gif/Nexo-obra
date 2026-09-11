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
const record = await vite.ssrLoadModule("/app/api/diary/[entryId]/route.ts");
const upload = await vite.ssrLoadModule("/app/api/diary/[entryId]/photos/route.ts");
const photo = await vite.ssrLoadModule("/app/api/diary/[entryId]/photos/[photoId]/route.ts");
const projects = await vite.ssrLoadModule("/app/api/diary/projects/route.ts");
const report = await vite.ssrLoadModule("/app/api/diary/report/route.ts");
const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
const { normalizePermissions } = await vite.ssrLoadModule("/lib/permissions.ts");
const { MAX_DIARY_PHOTO_BYTES } = await vite.ssrLoadModule("/lib/diary.ts");
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
  runtime.FILES = { // O armazenamento devolve a chave do objeto gravado; o caminho já vem único do handler.
  async put(path, value) { bytes.set(path, value); return path; }, async get(key) { return bytes.has(key) ? { body: new Response(bytes.get(key)).body } : null; }, async delete(key) { bytes.delete(key); } };
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

test("authentication, terms, and diary checkbox protect every entry point", async () => {
  const id = crypto.randomUUID();
  const checks = [
    (user) => list.GET(request("/api/diary", { user })),
    (user) => list.POST(request("/api/diary", { user, method: "POST", json: input() })),
    (user) => record.GET(request("/api/diary/x", { user }), parameters(id)),
    (user) => record.PATCH(request("/api/diary/x", { user, method: "PATCH", json: {} }), parameters(id)),
    (user) => upload.POST(request("/api/diary/x/photos", { user, method: "POST", body: photoForm() }), parameters(id)),
    (user) => photo.GET(request("/api/diary/x/photos/y", { user }), parameters(id, crypto.randomUUID())),
    (user) => report.GET(request("/api/diary/report", { user })),
    (user) => projects.GET(request("/api/diary/projects", { user })),
  ];
  for (const check of checks) { assert.equal((await check(null)).status, 401); assert.equal((await check("denied")).status, 403); }
  const superadminOnly = await list.GET(request("/api/diary", { user: null, headers: { cookie: "__Host-nexo-superadmin=not-a-tenant-session" } }));
  assert.equal(superadminOnly.status, 401);
  db.sqlite.prepare("DELETE FROM terms_acceptances WHERE id = 'owner-a'").run();
  assert.equal((await list.GET(request())).status, 403);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM site_diary_entries").get().n, 0);
});

test("create is durable and idempotent, with server-authored identity and initial history", async () => {
  const body = input();
  const first = await create(body);
  const retry = await create(body);
  assert.equal(first.id, retry.id); assert.equal(first.authorName, "owner-a");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM site_diary_entries").get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'diary.created'").get().n, 1);
  const response = await record.GET(request(), parameters(first.id));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const saved = await response.json(); assert.equal(saved.revisions[0].snapshot.summary, body.summary); assert.equal(saved.revisions[0].revision, 1);
  assert.equal((await list.POST(request("/api/diary", { method: "POST", json: { ...body, summary: "Texto diferente" } }))).status, 409);
});

test("tenant isolation applies to reads, writes, report, project choices and forged organization selection", async () => {
  const a = await create(); const b = await create({ projectId: projectB, summary: "Informação privada da empresa B" }, "other");
  const results = await (await list.GET(request("/api/diary", { headers: { cookie: `__Host-nexo-organization=${orgB}`, "x-organization-id": orgB } }))).json();
  assert.deepEqual(results.entries.map((entry) => entry.id), [a.id]);
  assert.equal((await record.GET(request(), parameters(b.id))).status, 404);
  assert.equal((await list.GET(request(`/api/diary?projectId=${projectB}`))).status, 404);
  assert.equal((await report.GET(request(`/api/diary/report?projectId=${projectB}`))).status, 404);
  assert.equal((await list.POST(request("/api/diary", { method: "POST", json: input({ projectId: projectB }) }))).status, 404);
  assert.equal((await upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm() }), parameters(b.id))).status, 404);
  const labels = await (await projects.GET(request("/api/diary/projects", { user: "reader" }))).json();
  assert.deepEqual(Object.keys(labels.projects[0]).sort(), ["code", "id", "name"]);
  assert.deepEqual(labels.projects.map((project) => project.id), [projectA]);
  const html = await (await report.GET(request("/api/diary/report"))).text(); assert.doesNotMatch(html, /Informação privada da empresa B/);
});

test("read-only collaborator can read but cannot create, correct, or attach photos", async () => {
  const entry = await create();
  assert.equal((await record.GET(request("/api/diary/x", { user: "reader" }), parameters(entry.id))).status, 200);
  assert.equal((await list.POST(request("/api/diary", { method: "POST", user: "reader", json: input() }))).status, 403);
  assert.equal((await record.PATCH(request("/api/diary/x", { method: "PATCH", user: "reader", json: {} }), parameters(entry.id))).status, 403);
  assert.equal((await upload.POST(request("/api/diary/x/photos", { method: "POST", user: "reader", body: photoForm() }), parameters(entry.id))).status, 403);
  assert.equal(bytes.size, 0);
  assert.deepEqual(normalizePermissions({ finance: { view: true, edit: false } }, "admin").diary, { view: false, edit: false });
  assert.deepEqual(normalizePermissions({ diary: { edit: true, view: false } }, "member").diary, { view: true, edit: true });
});

test("validation rejects impossible dates, incompatible occurrences, forged identity and invalid filters", async () => {
  for (const changes of [{ entryDate: "2026-02-30" }, { workforceCount: -1 }, { workforceCount: 2.5 }, { summary: "  " }, { summary: "x".repeat(10001) }, { organizationId: orgB }, { authorName: "Falso" }, { occurrenceType: "safety", blockers: "" }, { occurrenceType: "none", blockers: "Ocorrência" }]) {
    const response = await list.POST(request("/api/diary", { method: "POST", json: input(changes) })); assert.equal(response.status, 400, JSON.stringify(changes).slice(0, 150));
  }
  for (const suffix of ["?from=2026-09-10&to=2026-09-01", "?page=0", "?projectId=bad", "?q=" + "x".repeat(101)]) assert.equal((await list.GET(request(`/api/diary${suffix}`))).status, 400);
  assert.equal((await list.POST(request("/api/diary", { method: "POST", json: input(), headers: { origin: "https://untrusted.test" } }))).status, 403);
});

test("concurrent corrections cannot silently overwrite and every prior revision survives", async () => {
  const entry = await create();
  const correction = { entryDate: entry.entryDate, weather: entry.weather, workforceCount: entry.workforceCount, summary: "Correção da atividade", blockers: "", occurrenceType: "none", revision: 1, reason: "Ajuste do serviço executado" };
  const results = await Promise.all([
    record.PATCH(request("/api/diary/x", { method: "PATCH", json: correction }), parameters(entry.id)),
    record.PATCH(request("/api/diary/x", { method: "PATCH", user: "editor", json: { ...correction, summary: "Outra correção" } }), parameters(entry.id)),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const saved = await (await record.GET(request(), parameters(entry.id))).json();
  assert.equal(saved.entry.revision, 2); assert.equal(saved.revisions.length, 2); assert.equal(saved.revisions[1].snapshot.summary, entry.summary);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'diary.corrected'").get().n, 1);
  const outsider = await record.PATCH(request("/api/diary/x", { method: "PATCH", user: "other", json: { ...correction, revision: 2 } }), parameters(entry.id));
  assert.equal(outsider.status, 404);
});

test("text, revision and audit writes roll back together", async () => {
  db.failNextBatch = true;
  const originalError = console.error; console.error = () => {};
  try { assert.equal((await list.POST(request("/api/diary", { method: "POST", json: input() }))).status, 500); }
  finally { console.error = originalError; }
  for (const table of ["site_diary_entries", "diary_revisions", "audit_events"]) assert.equal(db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});

test("photos persist original bytes and integrity hash, with protected reads and retry safety", async () => {
  const entry = await create(); const id = crypto.randomUUID();
  const post = () => upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm({ id }) }), parameters(entry.id));
  const result = await post(); assert.equal(result.status, 201); const image = (await result.json()).photo;
  assert.equal((await post()).status, 201); assert.equal(bytes.size, 1); assert.match(image.sha256, /^[a-f0-9]{64}$/); assert.ok(!("storage_key" in image));
  const response = await photo.GET(request(image.url), parameters(entry.id, id));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("content-type"), "image/png"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal((await photo.GET(request(image.url, { user: "other" }), parameters(entry.id, id))).status, 404);
  assert.equal((await photo.GET(request(image.url, { user: null }), parameters(entry.id, id))).status, 401);
  const anotherEntry = await create(); assert.equal((await photo.GET(request(image.url), parameters(anotherEntry.id, id))).status, 404);
  const detail = await (await record.GET(request(), parameters(entry.id))).json(); assert.equal(detail.entry.photoCount, 1); assert.equal(detail.photos[0].uploadedByName, "owner-a");
});

test("photos reject MIME disguises, active content, oversized streams and preserve text on storage failure", async () => {
  const entry = await create();
  for (const form of [photoForm({ contents: "<svg><script>alert(1)</script></svg>", type: "image/png" }), photoForm({ type: "image/jpeg" }), photoForm({ contents: new Uint8Array(MAX_DIARY_PHOTO_BYTES + 1) })]) {
    const response = await upload.POST(request("/api/diary/x/photos", { method: "POST", body: form }), parameters(entry.id)); assert.ok([413, 415].includes(response.status));
  }
  delete runtime.FILES;
  assert.equal((await upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm() }), parameters(entry.id))).status, 503);
  assert.equal((await record.GET(request(), parameters(entry.id))).status, 200); assert.equal(bytes.size, 0);
});

test("photo count remains bounded and simultaneous uploads cannot claim the same slot", async () => {
  const entry = await create();
  // Hold both R2 requests until each writer has selected a slot, as on a slow storage connection.
  const put = runtime.FILES.put;
  let arrived = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  runtime.FILES.put = async (...args) => { const key = await put(...args); if (++arrived === 2) release(); await barrier; return key; };
  const pair = await Promise.all([1, 2].map(() => upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm() }), parameters(entry.id))));
  runtime.FILES.put = put;
  assert.deepEqual(pair.map((response) => response.status).sort(), [201, 409]); assert.equal(bytes.size, 1);
  for (let i = 1; i < 12; i++) assert.equal((await upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm() }), parameters(entry.id))).status, 201);
  assert.equal((await upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm() }), parameters(entry.id))).status, 409);
  assert.equal(bytes.size, 12);
});

test("failed photo transaction cleans only its own orphan and never removes the diary", async () => {
  const entry = await create();
  db.failNextBatch = true;
  const originalError = console.error; console.error = () => {};
  try { assert.equal((await upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm() }), parameters(entry.id))).status, 500); }
  finally { console.error = originalError; }
  assert.equal(bytes.size, 0); assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM diary_photos").get().n, 0);
  assert.equal((await record.GET(request(), parameters(entry.id))).status, 200);
});

test("legacy records are preserved on first correction and older history is paginated", async () => {
  const id = crypto.randomUUID();
  db.sqlite.prepare("INSERT INTO site_diary_entries(id, organization_id, project_id, entry_date, weather, summary, author_member_id) VALUES (?, ?, ?, '2026-09-01', 'clear', 'Texto legado preservado', 'owner-a')").run(id, orgA, projectA);
  for (let revision = 1; revision <= 22; revision++) {
    const response = await record.PATCH(request("/api/diary/x", { method: "PATCH", json: { entryDate: "2026-09-01", weather: "clear", workforceCount: 3, summary: `Atividade corrigida ${revision}`, blockers: "", occurrenceType: "none", revision, reason: "Correção documentada do registro" } }), parameters(id));
    assert.equal(response.status, 200);
  }
  const first = await (await record.GET(request(), parameters(id))).json();
  assert.equal(first.revisions.length, 20); assert.equal(first.nextHistoryBefore, 4);
  const last = await (await record.GET(request("/api/diary/x?historyBefore=4"), parameters(id))).json();
  assert.equal(last.revisions.length, 3); assert.equal(last.nextHistoryBefore, null); assert.equal(last.revisions.at(-1).snapshot.summary, "Texto legado preservado");
});

test("reports escape untrusted text, apply date filters and include only persisted photos", async () => {
  const entry = await create({ summary: '<script>alert("x")</script> & atividade', blockers: "Entrega pendente", occurrenceType: "materials" });
  await create({ entryDate: "2026-09-05", summary: "Registro de outro dia" });
  await upload.POST(request("/api/diary/x/photos", { method: "POST", body: photoForm({ caption: '<img onerror="alert(1)">' }) }), parameters(entry.id));
  const response = await report.GET(request("/api/diary/report?from=2026-09-06&to=2026-09-06&occurrencesOnly=true"));
  assert.equal(response.status, 200); assert.match(response.headers.get("content-security-policy"), /script-src 'nonce-/);
  const html = await response.text(); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>alert|<img onerror|Registro de outro dia/); assert.match(html, /SHA-256/); assert.match(html, /Imprimir \/ salvar PDF/);
  const literal = await (await list.GET(request("/api/diary?q=%27%20OR%201%3D1--"))).json(); assert.equal(literal.total, 0);
});

test("list pagination has stable ordering and report refuses silent truncation", async () => {
  for (let i = 0; i < 32; i++) await create({ summary: `Atividade número ${i}` });
  const one = await (await list.GET(request("/api/diary?page=1"))).json(); const two = await (await list.GET(request("/api/diary?page=2"))).json();
  assert.equal(one.total, 32); assert.equal(one.entries.length, 20); assert.equal(two.entries.length, 12);
  assert.equal(new Set([...one.entries, ...two.entries].map((entry) => entry.id)).size, 32);
  assert.equal((await report.GET(request("/api/diary/report"))).status, 422);
});
