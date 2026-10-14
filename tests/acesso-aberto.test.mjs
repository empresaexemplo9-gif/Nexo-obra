import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import { createHarness, orgA, orgB } from "./helpers/api-harness.mjs";

// Acesso aberto temporário: com ACESSO_ABERTO=true, o link entra como superadministrador
// sem login. Sem a variável, tudo continua exigindo sessão.

const harness = await createHarness();
after(() => harness.close());
beforeEach(() => {
  harness.reset();
  delete harness.runtime.ACESSO_ABERTO;
  harness.runtime.TRUST_IDENTITY_HEADERS = "false";
});

const anonymous = (path, org = orgA) => new Request(`https://platform.test${path}`, { headers: { cookie: `__Host-nexo-organization=${org}` } });

test("com ACESSO_ABERTO=true, um visitante sem login abre qualquer empresa como superadministrador", async () => {
  harness.runtime.ACESSO_ABERTO = "true";
  const session = await harness.load("/app/api/session/route.ts");
  const body = await (await session.GET(anonymous("/api/session", orgB))).json();
  assert.equal(body.authenticated, true);
  assert.equal(body.authMethod, "superadmin");
  assert.equal(body.organization.id, orgB);
  assert.deepEqual(body.organizations.map((item) => item.id).sort(), [orgA, orgB].sort());

  const admin = await harness.load("/app/api/superadmin/session/route.ts");
  const adminResponse = await admin.GET(anonymous("/api/superadmin/session"));
  assert.equal(adminResponse.status, 200);
  assert.equal((await adminResponse.json()).authenticated, true);
});

test("sem ACESSO_ABERTO, o visitante sem login continua barrado", async () => {
  const session = await harness.load("/app/api/session/route.ts");
  assert.equal((await (await session.GET(anonymous("/api/session"))).json()).authenticated, false);

  harness.runtime.ACESSO_ABERTO = "false";
  const admin = await harness.load("/app/api/superadmin/session/route.ts");
  assert.notEqual((await admin.GET(anonymous("/api/superadmin/session"))).status, 200);
});
