import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Porta de entrada do superadministrador: senha, bloqueio por tentativa e revogação de
// convite. É o que separa a plataforma inteira de quem tenta adivinhar uma senha.

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

const sessionRoute = await vite.ssrLoadModule("/app/api/superadmin/session/route.ts");
const superadmin = await vite.ssrLoadModule("/lib/server/superadmin.ts");
const organizations = await vite.ssrLoadModule("/app/api/superadmin/organizations/route.ts");
const invitations = await vite.ssrLoadModule("/app/api/superadmin/invitations/route.ts");
const revoke = await vite.ssrLoadModule("/app/api/superadmin/invitations/[invitationId]/route.ts");
const accept = await vite.ssrLoadModule("/app/api/invitations/[token]/accept/route.ts");

const EMAIL = "admin@plataforma.test";
const SENHA = "senha-real-do-superadmin-2026";
const secret = "test-only-shared-secret-at-least-32-characters";

// Gera o hash no mesmo formato que o servidor verifica: pbkdf2-sha256$100000$salt$digest.
const base64url = (bytes) => Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
async function passwordHash(password, separator = ":") {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return ["pbkdf2-sha256", "100000", base64url(salt), base64url(new Uint8Array(bits))].join(separator);
}

let db; let hash;
beforeEach(async () => {
  db?.sqlite.close(); db = new D1Local(); db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) db.sqlite.exec(migration);
  hash ??= await passwordHash(SENHA);
  Object.assign(runtime, { DB: db, TRUST_IDENTITY_HEADERS: "true", SUPERADMIN_EMAIL: EMAIL, SUPERADMIN_PASSWORD_HASH: hash, SUPERADMIN_SESSION_SECRET: secret });
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

const login = (body, headers = {}) => new Request("https://platform.test/api/superadmin/session", { method: "POST",
  headers: { "content-type": "application/json", "user-agent": "teste", "cf-connecting-ip": "203.0.113.10", ...headers },
  body: JSON.stringify(body) });

test("a senha correta abre a sessão e a errada não diz qual campo falhou", async () => {
  const certa = await sessionRoute.POST(login({ email: EMAIL, password: SENHA }));
  assert.equal(certa.status, 200, await certa.clone().text());
  const cookie = certa.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^__Host-nexo-superadmin=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, new RegExp(SENHA), "a senha nunca vai para o cookie");

  for (const tentativa of [{ email: EMAIL, password: "errada" }, { email: "outro@plataforma.test", password: SENHA }]) {
    const response = await sessionRoute.POST(login(tentativa));
    assert.equal(response.status, 401);
    // A mesma mensagem nos dois casos: não revela se o e-mail existe.
    assert.equal((await response.json()).error, "Usuário ou senha inválidos.");
  }
});

test("cinco tentativas erradas bloqueiam, e a senha certa não passa durante o bloqueio", async () => {
  for (let tentativa = 1; tentativa <= 4; tentativa += 1) {
    assert.equal((await sessionRoute.POST(login({ email: EMAIL, password: "errada" }))).status, 401, `tentativa ${tentativa}`);
  }
  const quinta = await sessionRoute.POST(login({ email: EMAIL, password: "errada" }));
  assert.equal(quinta.status, 401);

  const bloqueada = await sessionRoute.POST(login({ email: EMAIL, password: SENHA }));
  assert.equal(bloqueada.status, 429, "a senha correta também espera durante o bloqueio");
  assert.equal((await bloqueada.json()).code, "superadmin_login_locked");

  // Passados os quinze minutos, a porta reabre.
  db.sqlite.prepare("UPDATE superadmin_login_attempts SET locked_until = ?").run(Date.now() - 1);
  assert.equal((await sessionRoute.POST(login({ email: EMAIL, password: SENHA }))).status, 200);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM superadmin_login_attempts").get().n, 0,
    "o acerto limpa o histórico de tentativas");
});

test("a senha guardada nunca é comparada em texto e o hash não sai da configuração", async () => {
  assert.match(runtime.SUPERADMIN_PASSWORD_HASH, /^pbkdf2-sha256[:$]100000[:$]/);
  assert.equal(await superadmin.verifySuperAdminCredentials(EMAIL, SENHA), true);
  assert.equal(await superadmin.verifySuperAdminCredentials(EMAIL, `${SENHA} `), false);
  assert.equal(await superadmin.verifySuperAdminCredentials(EMAIL.toUpperCase(), SENHA), true, "o e-mail não diferencia maiúsculas");
  // Hash adulterado ou senha em texto puro nunca abrem acesso: agora recusam com erro
  // de configuração, o que é mais útil do que devolver "senha inválida".
  for (const configurado of ["pbkdf2-sha256:1000:abc:def", SENHA, "", "pbkdf2-sha256:100000:aa:bb"]) {
    runtime.SUPERADMIN_PASSWORD_HASH = configurado;
    await assert.rejects(
      superadmin.verifySuperAdminCredentials(EMAIL, SENHA),
      (error) => ["superadmin_hash_invalid", "superadmin_not_configured"].includes(error.code),
      `não deveria abrir com ${JSON.stringify(configurado)}`,
    );
  }
});

test("a sessão é assinada: um cookie adulterado não vale", async () => {
  const valido = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
  const check = (cookie) => sessionRoute.GET(new Request("https://platform.test/api/superadmin/session", { headers: { cookie } }));
  assert.equal((await check(valido)).status, 200);

  const [nome, token] = valido.split("=");
  const [payload, assinatura] = token.split(".");
  assert.equal((await check(`${nome}=${payload}.${assinatura.slice(0, -2)}xx`)).status, 401, "assinatura trocada");
  assert.equal((await check(`${nome}=${payload}`)).status, 401, "sem assinatura");
  assert.equal((await check("")).status, 401, "sem cookie");

  // Um payload remontado com outro e-mail, sem a chave, não passa.
  const forjado = Buffer.from(JSON.stringify({ sub: "invasor@teste", exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  assert.equal((await check(`${nome}=${forjado}.${assinatura}`)).status, 401);
});

test("a sessão expirada deixa de valer sozinha, e sair apaga o cookie", async () => {
  const expirado = Buffer.from(JSON.stringify({ sub: EMAIL, exp: Math.floor(Date.now() / 1000) - 10 }))
    .toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expirado))));
  const response = await sessionRoute.GET(new Request("https://platform.test/api/superadmin/session", {
    headers: { cookie: `__Host-nexo-superadmin=${expirado}.${assinatura}` } }));
  assert.equal(response.status, 401, "assinatura boa, prazo vencido: não vale");

  const saida = await sessionRoute.DELETE(new Request("https://platform.test/api/superadmin/session", { method: "DELETE" }));
  assert.match(saida.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("pedido vindo de outro site é recusado antes de tocar na senha", async () => {
  const response = await sessionRoute.POST(login({ email: EMAIL, password: SENHA }, { "sec-fetch-site": "cross-site" }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "cross_site_request");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM superadmin_login_attempts").get().n, 0);
});

test("convite revogado não vira acesso, e revogar exige a sessão da plataforma", async () => {
  const cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
  const admin = (path, init = {}) => new Request(`https://platform.test${path}`, { ...init,
    headers: { cookie, "content-type": "application/json", ...init.headers } });

  const { organization } = await (await organizations.POST(admin("/api/superadmin/organizations", { method: "POST",
    body: JSON.stringify({ name: "Escritório" }) }))).json();
  const criado = await (await invitations.POST(admin("/api/superadmin/invitations", { method: "POST",
    body: JSON.stringify({ organizationId: organization.id, email: "dono@escritorio.test", role: "owner", expiresInDays: 7 }) }))).json();
  const token = criado.invitationPath.split("/").at(-1);

  // Sem sessão, ninguém revoga.
  const semSessao = await revoke.DELETE(new Request(`https://platform.test/api/superadmin/invitations/${criado.invitation.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ invitationId: criado.invitation.id }) });
  assert.equal(semSessao.status, 401);

  const revogado = await revoke.DELETE(admin(`/api/superadmin/invitations/${criado.invitation.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ invitationId: criado.invitation.id }) });
  assert.equal(revogado.status, 200);

  // O link revogado não cria acesso nenhum.
  const tentativa = await accept.POST(new Request("https://platform.test/accept", { method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-id": "dono-1", "oai-authenticated-user-email": "dono@escritorio.test" },
    body: JSON.stringify({ acceptTerms: true }) }), { params: Promise.resolve({ token }) });
  assert.notEqual(tentativa.status, 200);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM members").get().n, 0, "nenhum membro foi criado");

  // Revogar de novo é inofensivo; um convite inexistente responde 404.
  assert.equal((await revoke.DELETE(admin(`/api/superadmin/invitations/${criado.invitation.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ invitationId: criado.invitation.id }) })).status, 200);
  assert.equal((await revoke.DELETE(admin("/api/superadmin/invitations/nao-existe", { method: "DELETE" }),
    { params: Promise.resolve({ invitationId: "nao-existe" }) })).status, 404);
});

test("um convite já aceito não pode ser revogado para apagar o vínculo", async () => {
  const cookie = (await superadmin.createSuperAdminSessionCookie()).cookie.split(";")[0];
  const admin = (path, init = {}) => new Request(`https://platform.test${path}`, { ...init,
    headers: { cookie, "content-type": "application/json", ...init.headers } });
  const { organization } = await (await organizations.POST(admin("/api/superadmin/organizations", { method: "POST",
    body: JSON.stringify({ name: "Escritório" }) }))).json();
  const criado = await (await invitations.POST(admin("/api/superadmin/invitations", { method: "POST",
    body: JSON.stringify({ organizationId: organization.id, email: "dono@escritorio.test", role: "owner", expiresInDays: 7 }) }))).json();
  const token = criado.invitationPath.split("/").at(-1);

  const aceite = await accept.POST(new Request("https://platform.test/accept", { method: "POST",
    headers: { "content-type": "application/json", "oai-authenticated-user-id": "dono-1", "oai-authenticated-user-email": "dono@escritorio.test" },
    body: JSON.stringify({ acceptTerms: true }) }), { params: Promise.resolve({ token }) });
  assert.equal(aceite.status, 200, await aceite.clone().text());

  const response = await revoke.DELETE(admin(`/api/superadmin/invitations/${criado.invitation.id}`, { method: "DELETE" }),
    { params: Promise.resolve({ invitationId: criado.invitation.id }) });
  assert.equal(response.status, 409);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM members").get().n, 1, "o acesso já criado permanece");
});

test("o hash funciona com dois-pontos e com dólar, e aspas do painel não atrapalham", async () => {
  for (const separador of [":", "$"]) {
    runtime.SUPERADMIN_PASSWORD_HASH = await passwordHash(SENHA, separador);
    assert.equal(await superadmin.verifySuperAdminCredentials(EMAIL, SENHA), true, `separador ${separador}`);
    assert.equal(await superadmin.verifySuperAdminCredentials(EMAIL, "outra"), false, `separador ${separador}`);
  }
  // Painel que guarda o valor entre aspas não deve derrubar o login.
  runtime.SUPERADMIN_PASSWORD_HASH = `'${await passwordHash(SENHA)}'`;
  assert.equal(await superadmin.verifySuperAdminCredentials(EMAIL, SENHA), true);
  runtime.SUPERADMIN_PASSWORD_HASH = ` ${await passwordHash(SENHA)} `;
  assert.equal(await superadmin.verifySuperAdminCredentials(EMAIL, SENHA), true);
});

test("hash mutilado pela expansão de variáveis avisa, em vez de dizer senha errada", async () => {
  // Foi o que aconteceu de verdade: o painel expandiu $salt e $digest como variáveis e o
  // login respondia "senha inválida" com a senha correta.
  runtime.SUPERADMIN_PASSWORD_HASH = "pbkdf2-sha256$100000-L";
  await assert.rejects(superadmin.verifySuperAdminCredentials(EMAIL, SENHA), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, "superadmin_hash_invalid");
    assert.match(error.message, /dois-pontos/);
    return true;
  });

  const resposta = await sessionRoute.POST(login({ email: EMAIL, password: SENHA }));
  assert.equal(resposta.status, 503);
  assert.equal((await resposta.json()).code, "superadmin_hash_invalid");
});

test("o login funciona num banco ainda não migrado, senão migrar seria impossível", async () => {
  // A rota que aplica migração exige sessão de superadministrador. Se o login dependesse
  // de tabela migrada, não haveria como sair do lugar.
  db.sqlite.exec("DROP TABLE IF EXISTS superadmin_login_attempts");
  runtime.SUPERADMIN_PASSWORD_HASH = await passwordHash(SENHA);

  const entrada = await sessionRoute.POST(login({ email: EMAIL, password: SENHA }));
  assert.equal(entrada.status, 200, await entrada.clone().text());
  assert.ok(db.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='superadmin_login_attempts'").get().n,
    "o portão criou a própria tabela de tentativas");

  // E o bloqueio continua valendo nesse banco.
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    await sessionRoute.POST(login({ email: EMAIL, password: "errada" }));
  }
  assert.equal((await sessionRoute.POST(login({ email: EMAIL, password: SENHA }))).status, 429);
});
