import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Autenticação própria: a pessoa passa a existir no link de convite, escolhendo a senha,
// e volta depois pelo login. Nada aqui depende de borda externa — é justamente o furo que
// esta camada fecha: sem ela, um visitante mandava `oai-authenticated-user-*` e virava
// quem quisesse.

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } },
  plugins: [{ name: "test-cloudflare-bindings", resolveId(id) { if (id === "cloudflare:workers") return "\0auth-runtime"; }, load(id) { if (id === "\0auth-runtime") return "export const env = globalThis.__platformEnvOverride;"; } }], server: { middlewareMode: true } });
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
const sessionRoute = await vite.ssrLoadModule("/app/api/auth/session/route.ts");
const superadmin = await vite.ssrLoadModule("/lib/server/superadmin.ts");
const organizations = await vite.ssrLoadModule("/app/api/superadmin/organizations/route.ts");
const invitations = await vite.ssrLoadModule("/app/api/superadmin/invitations/route.ts");
const accept = await vite.ssrLoadModule("/app/api/invitations/[token]/accept/route.ts");
const clients = await vite.ssrLoadModule("/app/api/clients/route.ts");

const EMAIL = "dono@escritorio.test";
const SENHA = "senha-do-convidado-2026";
const secret = "test-only-shared-secret-at-least-32-characters";
const base64url = (bytes) => Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

let db; let hashDaPlataforma;
beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  // Sem TRUST_IDENTITY_HEADERS: é o modo de produção, em que os cabeçalhos não valem nada.
  hashDaPlataforma ??= await auth.hashPassword("senha-da-plataforma-2026");
  Object.assign(runtime, {
    DB: db, SESSION_SECRET: secret, SUPERADMIN_SESSION_SECRET: secret,
    SUPERADMIN_EMAIL: "plataforma@nexo.test", SUPERADMIN_PASSWORD_HASH: hashDaPlataforma,
    TRUST_IDENTITY_HEADERS: undefined,
  });
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

// Cria empresa e convite pelo painel da plataforma e devolve o token do link.
async function convite(email = EMAIL, role = "owner") {
  const cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
  const admin = (path, init = {}) => new Request(`https://platform.test${path}`, { ...init,
    headers: { cookie, "content-type": "application/json", ...init.headers } });
  const { organization } = await (await organizations.POST(admin("/api/superadmin/organizations", { method: "POST",
    body: JSON.stringify({ name: "Escritório" }) }))).json();
  const criado = await (await invitations.POST(admin("/api/superadmin/invitations", { method: "POST",
    body: JSON.stringify({ organizationId: organization.id, email, role, expiresInDays: 7 }) }))).json();
  return { organizationId: organization.id, token: criado.invitationPath.split("/").at(-1) };
}

const aceitar = (token, body, headers = {}) => accept.POST(new Request("https://platform.test/accept", { method: "POST",
  headers: { "content-type": "application/json", "user-agent": "teste", "cf-connecting-ip": "203.0.113.7", ...headers },
  body: JSON.stringify(body) }), { params: Promise.resolve({ token }) });

const entrar = (body, headers = {}) => sessionRoute.POST(new Request("https://platform.test/api/auth/session", { method: "POST",
  headers: { "content-type": "application/json", "user-agent": "teste", "cf-connecting-ip": "203.0.113.7", ...headers },
  body: JSON.stringify(body) }));

const cookiesDe = (response) => (response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""])
  .map((item) => item.split(";")[0]).filter(Boolean).join("; ");

test("cabeçalho de identidade não autentica ninguém por padrão", async () => {
  const { organizationId } = await convite();
  const resposta = await clients.GET(new Request("https://platform.test/api/clients", {
    headers: { "oai-authenticated-user-id": "invasor", "oai-authenticated-user-email": "invasor@teste.test",
      cookie: `__Host-nexo-organization=${organizationId}` } }));
  assert.equal(resposta.status, 401, "o cabeçalho é só um texto que qualquer visitante envia");
  assert.equal((await resposta.json()).code, "sign_in_required");

  // Só passa a valer quando a hospedagem declara que está atrás de uma borda que o sobrescreve.
  runtime.TRUST_IDENTITY_HEADERS = "true";
  assert.notEqual((await clients.GET(new Request("https://platform.test/api/clients", {
    headers: { "oai-authenticated-user-id": "invasor", "oai-authenticated-user-email": "invasor@teste.test",
      cookie: `__Host-nexo-organization=${organizationId}` } }))).status, 401);
});

test("aceitar o convite cria a senha, abre a sessão e o acesso já funciona", async () => {
  const { token, organizationId } = await convite();

  // Sem identidade nenhuma e sem senha, não há como saber quem volta amanhã.
  const semSenha = await aceitar(token, { acceptTerms: true });
  assert.equal(semSenha.status, 400);
  assert.equal((await semSenha.json()).code, "password_required");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM members").get().n, 0);

  const fraca = await aceitar(token, { acceptTerms: true, password: "123456" });
  assert.equal(fraca.status, 400);
  assert.equal((await fraca.json()).code, "weak_password");

  const aceite = await aceitar(token, { acceptTerms: true, password: SENHA });
  assert.equal(aceite.status, 200, await aceite.clone().text());
  const cookies = cookiesDe(aceite);
  assert.match(cookies, /__Host-nexo-session=/, "aceitar já entra: senão a pessoa criaria a senha e ficaria de fora");
  assert.match(cookies, new RegExp(`__Host-nexo-organization=${organizationId}`));
  assert.doesNotMatch(cookies, new RegExp(SENHA), "a senha nunca vai para o cookie");

  const guardado = db.sqlite.prepare("SELECT password_hash, active FROM user_credentials WHERE email = ?").get(EMAIL);
  assert.match(guardado.password_hash, /^pbkdf2-sha256:100000:/, "senha só existe como hash");
  assert.equal(guardado.active, 1);
  assert.equal(db.sqlite.prepare("SELECT role FROM members WHERE email = ?").get(EMAIL).role, "owner");

  // A sessão emitida no aceite já vale nas rotas de negócio.
  const lista = await clients.GET(new Request("https://platform.test/api/clients", { headers: { cookie: cookies } }));
  assert.equal(lista.status, 200, await lista.clone().text());
});

test("o login devolve a sessão, e e-mail inexistente e senha errada respondem igual", async () => {
  const { token } = await convite();
  assert.equal((await aceitar(token, { acceptTerms: true, password: SENHA })).status, 200);

  const certa = await entrar({ email: EMAIL, password: SENHA });
  assert.equal(certa.status, 200, await certa.clone().text());
  const cookie = certa.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^__Host-nexo-session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal((await certa.json()).user.email, EMAIL);

  for (const tentativa of [{ email: EMAIL, password: "senha-errada-mas-longa" }, { email: "ninguem@escritorio.test", password: SENHA }]) {
    const resposta = await entrar(tentativa, { "cf-connecting-ip": "198.51.100.1" });
    assert.equal(resposta.status, 401);
    assert.equal((await resposta.json()).error, "E-mail ou senha inválidos.");
  }

  // E o e-mail não diferencia maiúsculas nem espaço em volta.
  assert.equal((await entrar({ email: ` ${EMAIL.toUpperCase()} `, password: SENHA })).status, 200);
});

test("cinco erros bloqueiam por quinze minutos, inclusive para a senha correta", async () => {
  const { token } = await convite();
  assert.equal((await aceitar(token, { acceptTerms: true, password: SENHA })).status, 200);

  for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
    assert.equal((await entrar({ email: EMAIL, password: "errada-porem-longa" })).status, 401, `tentativa ${tentativa}`);
  }
  const bloqueada = await entrar({ email: EMAIL, password: SENHA });
  assert.equal(bloqueada.status, 429);
  assert.equal((await bloqueada.json()).code, "sign_in_locked");

  // Passado o prazo, a porta reabre e o acerto limpa o histórico.
  db.sqlite.prepare("UPDATE superadmin_login_attempts SET locked_until = ?").run(Date.now() - 1);
  assert.equal((await entrar({ email: EMAIL, password: SENHA })).status, 200);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM superadmin_login_attempts").get().n, 0);

  // O bloqueio é por origem: outra rede não herda a espera de quem errou.
  db.sqlite.prepare("INSERT INTO superadmin_login_attempts(fingerprint,failed_count,window_started_at,locked_until,updated_at) VALUES ('user:outro',5,?,?,?)")
    .run(Date.now(), Date.now() + 60_000, Date.now());
  assert.equal((await entrar({ email: EMAIL, password: SENHA }, { "cf-connecting-ip": "198.51.100.9" })).status, 200);
});

test("a sessão é assinada e expira sozinha; um cookie forjado não vale", async () => {
  const { token } = await convite();
  assert.equal((await aceitar(token, { acceptTerms: true, password: SENHA })).status, 200);
  const valido = (await entrar({ email: EMAIL, password: SENHA })).headers.get("set-cookie").split(";")[0];

  const quem = (cookie) => sessionRoute.GET(new Request("https://platform.test/api/auth/session", { headers: { cookie } }));
  assert.equal((await (await quem(valido)).json()).authenticated, true);

  const [nome, valor] = valido.split("=");
  const [payload, assinatura] = valor.split(".");
  for (const adulterado of [`${nome}=${payload}.${assinatura.slice(0, -2)}xx`, `${nome}=${payload}`, `${nome}=`, ""]) {
    assert.equal((await (await quem(adulterado)).json()).authenticated, false, `deveria recusar ${adulterado}`);
  }

  // Payload remontado com outro e-mail, reaproveitando a assinatura alheia: não passa.
  const forjado = base64url(Buffer.from(JSON.stringify({ sub: "invasor", email: "invasor@teste.test", exp: Math.floor(Date.now() / 1000) + 3600 })));
  assert.equal((await (await quem(`${nome}=${forjado}.${assinatura}`)).json()).authenticated, false);

  // Assinatura boa, prazo vencido: deixa de valer sem ninguém precisar revogar.
  const vencido = base64url(Buffer.from(JSON.stringify({ sub: "alguem", email: EMAIL, exp: Math.floor(Date.now() / 1000) - 10 })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const boa = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(vencido))));
  assert.equal((await (await quem(`${nome}=${vencido}.${boa}`)).json()).authenticated, false);

  // Um segredo diferente invalida o cookie inteiro: a sessão não é transferível entre ambientes.
  runtime.SESSION_SECRET = "outro-segredo-de-teste-com-mais-de-32-chars";
  assert.equal((await (await quem(valido)).json()).authenticated, false);
  runtime.SESSION_SECRET = secret;

  const saida = await sessionRoute.DELETE(new Request("https://platform.test/api/auth/session", { method: "DELETE" }));
  assert.match(saida.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("pedido de login vindo de outro site é recusado antes de tocar na senha", async () => {
  const { token } = await convite();
  assert.equal((await aceitar(token, { acceptTerms: true, password: SENHA })).status, 200);
  const resposta = await entrar({ email: EMAIL, password: SENHA }, { "sec-fetch-site": "cross-site" });
  assert.equal(resposta.status, 403);
  assert.equal((await resposta.json()).code, "cross_site_request");
});

test("hash de senha: sal por senha, verificação exata e formato sem $", async () => {
  const primeiro = await auth.hashPassword(SENHA);
  const segundo = await auth.hashPassword(SENHA);
  assert.notEqual(primeiro, segundo, "cada senha ganha sal próprio: dois iguais não geram o mesmo hash");
  assert.doesNotMatch(primeiro, /\$/, "sem $: painéis de publicação expandem o caractere e mutilam o valor");
  assert.equal(await auth.passwordMatches(SENHA, primeiro), true);
  assert.equal(await auth.passwordMatches(SENHA, segundo), true);
  assert.equal(await auth.passwordMatches(`${SENHA} `, primeiro), false);
  for (const quebrado of ["", SENHA, "pbkdf2-sha256:1000:abc:def", "pbkdf2-sha256:100000:aa:bb"]) {
    assert.equal(await auth.passwordMatches(SENHA, quebrado), false, `não deveria aceitar ${JSON.stringify(quebrado)}`);
  }
  // O formato antigo, com $ como separador, continua sendo lido.
  assert.equal(await auth.passwordMatches(SENHA, primeiro.replaceAll(":", "$")), true);
});
