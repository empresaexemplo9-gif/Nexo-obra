import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB } from "./helpers/api-harness.mjs";

// Link de acesso temporário: /acesso/<chave> abre uma sessão de superadministrador sem
// senha. O endereço comum continua pedindo login, e trocar a chave derruba as sessões.

const harness = await createHarness();
after(() => harness.close());
const chave = "c".repeat(40);
beforeEach(() => {
  harness.reset();
  harness.runtime.TRUST_IDENTITY_HEADERS = "false";
  harness.runtime.LINK_ACESSO_CHAVE = chave;
});

const params = (value) => ({ params: Promise.resolve({ chave: value }) });
const visit = (path, cookie = "", org = orgA) => new Request(`https://platform.test${path}`, {
  headers: { cookie: [`__Host-nexo-organization=${org}`, cookie].filter(Boolean).join("; ") },
});

async function openLink(value = chave) {
  const route = await harness.load("/app/acesso/[chave]/route.ts");
  return route.GET(visit(`/acesso/${value}`), params(value));
}

test("o link com a chave certa entra como superadministrador em qualquer empresa", async () => {
  const response = await openLink();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(cookie, /^__Host-nexo-link=/);

  const session = await harness.load("/app/api/session/route.ts");
  const body = await (await session.GET(visit("/api/session", cookie, orgB))).json();
  assert.equal(body.authenticated, true);
  assert.equal(body.authMethod, "superadmin");
  assert.equal(body.organization.id, orgB);

  const admin = await harness.load("/app/api/superadmin/session/route.ts");
  assert.equal((await admin.GET(visit("/api/superadmin/session", cookie))).status, 200);
});

test("sem o link, com chave errada ou depois de trocar a chave, o acesso continua fechado", async () => {
  const session = await harness.load("/app/api/session/route.ts");
  assert.equal((await (await session.GET(visit("/api/session"))).json()).authenticated, false);

  const wrong = await openLink("d".repeat(40));
  assert.equal(wrong.status, 404);
  assert.equal(wrong.headers.get("set-cookie"), null);

  const cookie = (await openLink()).headers.get("set-cookie").split(";")[0];
  harness.runtime.LINK_ACESSO_CHAVE = "e".repeat(40);
  assert.equal((await (await session.GET(visit("/api/session", cookie))).json()).authenticated, false);

  delete harness.runtime.LINK_ACESSO_CHAVE;
  assert.equal((await openLink()).status, 404);
  harness.runtime.LINK_ACESSO_CHAVE = "curta";
  assert.equal((await openLink("curta")).status, 404);
});
