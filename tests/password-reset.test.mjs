import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB, params, permissions } from "./helpers/api-harness.mjs";

// Nova senha por link de uso único, gerado por quem administra a empresa. A senha é única
// para todas as empresas da pessoa: nenhum administrador pode gerar link para conta que
// também existe em outra empresa, nem para o contratante — isso fica com o superadmin.

const h = await createHarness();
after(() => h.close());
beforeEach(() => {
  h.reset();
  Object.assign(h.runtime, { SESSION_SECRET: "s".repeat(40), LINK_ACESSO_CHAVE: "k".repeat(40) });
});

const resetRoute = await h.load("/app/api/members/[memberId]/password-reset/route.ts");
const tokenRoute = await h.load("/app/api/password-reset/[token]/route.ts");
const passwordRoute = await h.load("/app/api/auth/password/route.ts");
const sessionRoute = await h.load("/app/api/session/route.ts");
const auth = await h.load("/lib/server/auth.ts");
const superadmin = await h.load("/lib/server/superadmin.ts");

const issue = (actor, memberId, org = orgA, headers = {}) => resetRoute.POST(h.request(actor, `/api/members/${memberId}/password-reset`, { method: "POST", org, headers }), params({ memberId }));
const tokenOf = async (response) => (await response.json()).resetPath.split("/").pop();
const anon = (path, init = {}) => new Request(`https://platform.test${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
const redeem = (token, password) => tokenRoute.POST(anon(`/api/password-reset/${token}`, { method: "POST", body: JSON.stringify({ password }) }), params({ token }));
async function credential(userId, password = "SenhaAntiga123") {
  h.db.sqlite.prepare("INSERT INTO user_credentials (user_id,email,password_hash,display_name,active,password_updated_at,created_at) VALUES (?,?,?,?,1,?,?)")
    .run(userId, `${userId}@example.test`, await auth.hashPassword(password), userId, Date.now() - 60_000, Date.now() - 60_000);
}
const cookieOf = (setCookie) => setCookie.split(";")[0];
const sessionFor = async (cookie) => (await (await sessionRoute.GET(new Request("https://platform.test/api/session", { headers: { cookie: `${cookie}; __Host-nexo-organization=${orgA}` } }))).json());

test("o dono gera o link, a pessoa cria a senha uma única vez e as sessões antigas caem", async () => {
  const colab = h.member("colab", orgA, "Colaboradora");
  await credential("colab");
  const old = await auth.createSessionCookie({ id: "colab", email: "colab@example.test", displayName: "Colaboradora" });
  h.runtime.TRUST_IDENTITY_HEADERS = "true";

  const issued = await issue("owner", colab);
  assert.equal(issued.status, 201);
  const token = await tokenOf(issued);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM password_resets WHERE token_hash = ?").get(token).n, 0, "o token nunca é gravado em claro");

  const info = await (await tokenRoute.GET(anon(`/api/password-reset/${token}`), params({ token }))).json();
  assert.equal(info.email, "colab@example.test");
  assert.equal((await redeem(token, "curta")).status, 400);
  const done = await redeem(token, "SenhaNova12345");
  assert.equal(done.status, 200);
  assert.equal((await redeem(token, "OutraSenha12345")).status, 409);

  assert.ok(await auth.signIn(new Request("https://platform.test/"), "colab@example.test", "SenhaNova12345"));
  await assert.rejects(auth.signIn(new Request("https://platform.test/"), "colab@example.test", "SenhaAntiga123"));

  h.runtime.TRUST_IDENTITY_HEADERS = "false";
  assert.equal((await sessionFor(cookieOf(old.cookie))).authenticated, false);
  const actions = h.db.sqlite.prepare("SELECT action FROM audit_events WHERE action LIKE 'member.password_reset%' ORDER BY created_at").all().map((row) => row.action);
  assert.deepEqual(actions, ["member.password_reset_issued", "member.password_reset_used"]);
});

test("gerar um novo link cancela o anterior, e link expirado não vale", async () => {
  const colab = h.member("colab", orgA, "Colaboradora");
  const first = await tokenOf(await issue("owner", colab));
  const second = await tokenOf(await issue("owner", colab));
  assert.equal((await redeem(first, "SenhaNova12345")).status, 410);
  h.db.sqlite.prepare("UPDATE password_resets SET expires_at = 1").run();
  assert.equal((await redeem(second, "SenhaNova12345")).status, 410);
  assert.equal((await redeem("token-que-nao-existe", "SenhaNova12345")).status, 404);
});

test("ninguém toma conta alheia: contratante, conta em outra empresa, nível acima e quem não administra", async () => {
  const admin = h.member("admin", orgA, "Admin", "admin");
  const owner = "owner@" + orgA;
  const ownerBlocked = await issue("admin", owner);
  assert.equal(ownerBlocked.status, 403, "admin não redefine o contratante");
  assert.equal((await ownerBlocked.json()).code, "owner_password_reset");

  const shared = h.member("shared", orgA, "Compartilhada");
  h.member("shared", orgB, "Compartilhada");
  const blocked = await issue("owner", shared);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, "shared_account_password_reset");

  const limited = h.member("limited", orgA, "Gestor", "manager", permissions({ finance: { view: false, edit: false } }));
  h.db.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(limited);
  const finance = h.member("fin", orgA, "Financeiro", "finance", permissions());
  const beyond = await issue("limited", finance);
  assert.equal(beyond.status, 403, "não gera para quem tem acesso acima do seu");
  assert.equal((await beyond.json()).code, "permission_beyond_grantor");

  const plain = h.member("plain", orgA, "Colaborador", "member", permissions({ team: { view: true, edit: false } }));
  const notAdmin = await issue("plain", admin);
  assert.equal(notAdmin.status, 403);
  assert.equal((await notAdmin.json()).code, "module_permission_denied");
  assert.equal((await issue("owner", "owner@" + orgB)).status, 404, "membro de outra empresa não é encontrado");
  assert.equal((await issue("owner", owner)).status, 400, "a própria senha se troca no menu da conta");
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM password_resets").get().n, 0);
  void plain;
});

test("o superadministrador gera o link do contratante e de conta em várias empresas", async () => {
  h.runtime.TRUST_IDENTITY_HEADERS = "false";
  const link = cookieOf(await superadmin.createLinkAccessCookie());
  const shared = h.member("shared", orgA, "Compartilhada");
  h.member("shared", orgB, "Compartilhada");
  const asAdmin = (memberId) => resetRoute.POST(new Request(`https://platform.test/api/members/${memberId}/password-reset`, {
    method: "POST", headers: { cookie: `${link}; __Host-nexo-organization=${orgA}` },
  }), params({ memberId }));
  assert.equal((await asAdmin("owner@" + orgA)).status, 201);
  assert.equal((await asAdmin(shared)).status, 201);
});

test("trocar a própria senha exige a atual e derruba as outras sessões", async () => {
  h.runtime.TRUST_IDENTITY_HEADERS = "false";
  h.member("colab", orgA, "Colaboradora");
  await credential("colab", "SenhaAntiga123");
  const other = cookieOf((await auth.createSessionCookie({ id: "colab", email: "colab@example.test", displayName: "C" })).cookie);
  const mine = cookieOf((await auth.createSessionCookie({ id: "colab", email: "colab@example.test", displayName: "C" })).cookie);
  const change = (cookie, currentPassword, newPassword) => passwordRoute.POST(anon("/api/auth/password", { method: "POST", headers: { cookie }, body: JSON.stringify({ currentPassword, newPassword }) }));

  assert.equal((await change(mine, "errada", "SenhaNova12345")).status, 401);
  assert.equal((await change(mine, "SenhaAntiga123", "curta")).status, 400);
  const ok = await change(mine, "SenhaAntiga123", "SenhaNova12345");
  assert.equal(ok.status, 200);
  const fresh = cookieOf(ok.headers.get("set-cookie"));
  assert.equal((await sessionFor(fresh)).authenticated, true);
  assert.equal((await sessionFor(other)).authenticated, false);
  assert.equal((await change("", "SenhaNova12345", "OutraSenha12345")).status, 401);
});
