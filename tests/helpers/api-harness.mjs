// Banco em memória com todas as migrações, duas empresas e o armazenamento de objetos em
// memória. As rotas, a autorização, a cifra e o SQL são os reais; só a rede fica de fora.
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const root = fileURLToPath(new URL("../..", import.meta.url));
export const orgA = "11111111-1111-4111-8111-111111111111";
export const orgB = "22222222-2222-4222-8222-222222222222";

const areas = ["overview", "projects", "budgets", "schedule", "diary", "portal", "crm", "finance", "team", "tasks", "files", "studio"];
export function permissions(overrides = {}, base = true) {
  return JSON.stringify({ ...Object.fromEntries(areas.map((area) => [area, { view: base, edit: base }])), ...overrides });
}

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

export async function createHarness() {
  const runtime = {};
  globalThis.__platformEnvOverride = runtime;
  const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
  const { CURRENT_TERMS_VERSION } = await vite.ssrLoadModule("/lib/terms.ts");
  const migrations = await Promise.all((await readdir(`${root}/drizzle`)).filter((file) => file.endsWith(".sql")).sort().map((file) => readFile(`${root}/drizzle/${file}`, "utf8")));
  const harness = { runtime, vite, db: null, objects: new Map() };

  harness.load = (path) => vite.ssrLoadModule(path);

  harness.reset = () => {
    harness.db?.sqlite.close();
    const db = new D1Local();
    db.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations) db.sqlite.exec(migration);
    harness.db = db;
    harness.objects = new Map();
    for (const [org, name] of [[orgA, "Escritório A"], [orgB, "Construtora B"]]) {
      db.sqlite.prepare("INSERT INTO organizations(id,name,slug,timezone,created_at,updated_at) VALUES (?,?,?,'America/Sao_Paulo',0,0)").run(org, name, org);
    }
    harness.member("owner", orgA, "Ana Dona", "owner");
    harness.member("owner-b", orgB, "Bruno Dono", "owner");
    db.sqlite.prepare("INSERT INTO projects(id,organization_id,code,name,type,kind,status,created_at,updated_at) VALUES ('p-a',?,'ARQ-1','Casa Alfa','work','work','active',0,0)").run(orgA);
    db.sqlite.prepare("INSERT INTO projects(id,organization_id,code,name,type,kind,status,created_at,updated_at) VALUES ('p-b',?,'OBR-9','Galpão Beta','work','work','active',0,0)").run(orgB);
    Object.assign(runtime, {
      DB: db, TRUST_IDENTITY_HEADERS: "true",
      MEDIA_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      FILES: {
        async put(path, value) { harness.objects.set(path, new Uint8Array(value)); return path; },
        async get(key) { return harness.objects.has(key) ? { body: new Response(harness.objects.get(key)).body } : null; },
        async delete(key) { harness.objects.delete(key); },
      },
    });
    delete runtime.DWG_CONVERTER_URL;
  };

  /** Cria usuário e membro com o id do usuário igual ao do membro, para simplificar. */
  harness.member = (id, org, name, role = "member", perms = permissions()) => {
    const email = `${id}@example.test`;
    const db = harness.db;
    db.sqlite.prepare("INSERT OR IGNORE INTO users(id,email,display_name,created_at,updated_at) VALUES (?,?,?,0,0)").run(id, email, name);
    db.sqlite.prepare("INSERT INTO members(id,organization_id,external_user_id,name,email,role,permissions_json) VALUES (?,?,?,?,?,?,?)")
      .run(`${id}@${org}`, org, id, name, email, role, perms);
    db.sqlite.prepare("INSERT INTO terms_acceptances(id,organization_id,external_user_id,email,terms_version,ip_hash,user_agent_hash,accepted_at) VALUES (?,?,?,?,?,'','',1)")
      .run(`t-${id}-${org}`, org, id, email, CURRENT_TERMS_VERSION);
    return `${id}@${org}`;
  };

  harness.request = (user, path, { method = "GET", json, body, org = orgA, headers = {} } = {}) => new Request(`https://platform.test${path}`, {
    method,
    headers: {
      "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test`,
      cookie: `__Host-nexo-organization=${org}`,
      ...(json ? { "content-type": "application/json" } : {}), ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  });

  harness.close = async () => { harness.db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; };
  return harness;
}

export const params = (values) => ({ params: Promise.resolve(values) });
