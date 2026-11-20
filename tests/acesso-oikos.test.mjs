import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Espaço Oikos: empresa contratante com marca própria. O login "oikos@admin" abre a
// empresa como dono, e a sessão devolve a marca dela — derivada da empresa resolvida no
// servidor, nunca do navegador.

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
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

const auth = await vite.ssrLoadModule("/lib/server/auth.ts");
const loginRoute = await vite.ssrLoadModule("/app/api/auth/session/route.ts");
const sessionRoute = await vite.ssrLoadModule("/app/api/session/route.ts");
const clients = await vite.ssrLoadModule("/app/api/clients/route.ts");
const marca = await vite.ssrLoadModule("/lib/marca.ts");

const secret = "test-only-shared-secret-at-least-32-characters";
let db;
beforeEach(() => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  Object.assign(runtime, { DB: db, SESSION_SECRET: secret, SUPERADMIN_SESSION_SECRET: secret, TRUST_IDENTITY_HEADERS: undefined });
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

const entrar = (email, password, ip = "203.0.113.9") => loginRoute.POST(new Request("https://platform.test/api/auth/session", {
  method: "POST", headers: { "content-type": "application/json", "user-agent": "teste", "cf-connecting-ip": ip },
  body: JSON.stringify({ email, password }) }));
const cookieDe = (response) => (response.headers.get("set-cookie") ?? "").split(";")[0];
const sessao = async (cookie) => (await sessionRoute.GET(new Request("https://platform.test/api/session", { headers: { cookie } }))).json();

test("oikos@admin com a senha combinada abre a empresa Oikos como dono e com a marca dela", async () => {
  const resposta = await entrar("oikos@admin", "oikos.admin");
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  assert.equal(corpo.scope, "account");
  const dados = await sessao(cookieDe(resposta));
  assert.equal(dados.organization.id, marca.OIKOS_ORGANIZATION_ID);
  assert.equal(dados.organization.name, "Oikos");
  assert.equal(dados.member.role, "owner");
  assert.equal(dados.marca, "oikos");
  assert.equal(dados.authMethod, "password");
  // Dono tem tudo liberado, como qualquer contratante; o aceite dos termos é dele.
  for (const permissao of Object.values(dados.member.permissions)) assert.deepEqual(permissao, { view: true, edit: true });
  assert.equal(dados.terms.accepted, false);
});

test("senha errada não entra e repetir o login não duplica empresa, conta nem vínculo", async () => {
  const errada = await entrar("oikos@admin", "outra-senha");
  assert.equal(errada.status, 401);
  assert.equal((await errada.json()).code, "invalid_credentials");
  assert.equal((await entrar("OIKOS@admin", "oikos.admin")).status, 200);
  assert.equal((await entrar("oikos@admin", "oikos.admin")).status, 200);
  const conta = (tabela) => db.sqlite.prepare(`SELECT COUNT(*) n FROM ${tabela} WHERE organization_id = ?`).get(marca.OIKOS_ORGANIZATION_ID).n;
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM organizations WHERE id = ?").get(marca.OIKOS_ORGANIZATION_ID).n, 1);
  assert.equal(conta("members"), 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM user_credentials WHERE email = 'oikos@admin'").get().n, 1);
  // A senha guardada é hash, nunca o texto.
  assert.doesNotMatch(db.sqlite.prepare("SELECT password_hash h FROM user_credentials WHERE email = 'oikos@admin'").get().h, /oikos\.admin/);
});

test("senha trocada pelo dono vale sozinha: a combinada deixa de abrir", async () => {
  assert.equal((await entrar("oikos@admin", "oikos.admin")).status, 200);
  db.sqlite.prepare("UPDATE user_credentials SET password_hash = ?, password_updated_at = ? WHERE email = 'oikos@admin'")
    .run(await auth.hashPassword("nova-senha-do-dono-2026"), Date.now());
  assert.equal((await entrar("oikos@admin", "oikos.admin", "203.0.113.10")).status, 401);
  assert.equal((await entrar("oikos@admin", "nova-senha-do-dono-2026", "203.0.113.10")).status, 200);
});

test("o acesso Oikos não alcança outra empresa e as outras empresas seguem com a marca da plataforma", async () => {
  const cookie = cookieDe(await entrar("oikos@admin", "oikos.admin"));
  const agora = Date.now();
  db.sqlite.prepare("INSERT INTO organizations (id, name, slug, timezone, created_at, updated_at) VALUES ('org-outra', 'Outra', 'outra', 'America/Sao_Paulo', ?, ?)").run(agora, agora);
  const negado = await clients.GET(new Request("https://platform.test/api/clients", { headers: { cookie: `${cookie}; __Host-nexo-organization=org-outra` } }));
  assert.equal(negado.status, 403);
  assert.equal((await negado.json()).code, "organization_forbidden");

  assert.equal(marca.marcaDaOrganizacao("org-outra"), "drap");
  assert.equal(marca.marcaDaOrganizacao(undefined), "drap");
  // Login que não é e-mail continua recusado para todo o resto.
  assert.equal((await entrar("qualquer@admin", "oikos.admin")).status, 400);
});

test("o tema H.OIKOS só vale com a marca no documento", async () => {
  const css = await readFile(`${root}/app/oikos-tema.css`, "utf8");
  const layout = await readFile(`${root}/app/layout.tsx`, "utf8");
  assert.match(layout, /import "\.\/oikos-tema\.css"/);
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Todo seletor de regra (fora de @keyframes) começa pelo escopo da marca.
  const seletores = [...semComentarios.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
    .matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].replace(/@media[^{]*\{/g, "").trim()).filter(Boolean);
  assert.ok(seletores.length > 50);
  for (const seletor of seletores) {
    for (const parte of seletor.split(/,(?![^(]*\))/)) assert.match(parte.trim(), /^:root(\[data-marca="oikos"\]|:not\(\[data-marca="oikos"\]\))/, parte);
  }
  assert.match(css, /--hoikos-earth: #38301B/);
  assert.match(css, /--hoikos-gold: #846100/);
  assert.doesNotMatch(semComentarios, /workspace-content[^{]*\{[^}]*max-width/, "a área de trabalho continua na largura toda");
});
