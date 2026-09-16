import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(`${root}/${path}`, "utf8");

test("DRAP signup uses only the official signup URL and audits the redirect", async () => {
  const route = await source("app/api/integrations/drap/signup/route.ts");
  assert.match(route, /https:\/\/empresa\.drap\.app\.br\/signup/);
  assert.match(route, /integration\.drap_signup_started/);
  assert.doesNotMatch(route, /redirectUrl\s*:\s*parsed|new URL\([^)]*catalogItemId/);
});

test("H.OIKOS sends the requested DRAP-ready confirmation only after an active connection", async () => {
  const connection = await source("app/api/integrations/drap/connection/route.ts");
  const email = await source("lib/server/transactional-email.ts");
  assert.match(connection, /requestDrapApi\(externalCompanyId, "\/api\/v1\/lancamentos\?limit=1&offset=0"\)/);
  assert.match(connection, /verification\.status === "active"/);
  assert.match(connection, /sendReadyNotifications/);
  assert.match(email, /Você já pode usar as soluções financeiras DRAP no seu ecossistema H\.OIKOS\./);
  assert.match(email, /https:\/\/api\.resend\.com\/emails/);
  assert.doesNotMatch(email, /NEXT_PUBLIC_/);
});

test("solutions screen redirects to DRAP signup while keeping operations in H.OIKOS", async () => {
  const ui = await source("components/drap-solutions-workspace.tsx");
  assert.match(ui, /\/api\/integrations\/drap\/signup/);
  assert.match(ui, /window\.location\.assign\(body\.redirectUrl\)/);
  assert.match(ui, /Criar conta DRAP/);
  assert.match(ui, /Quando o vínculo for validado, a H\.OIKOS enviará um e-mail de confirmação/);
});

test("transactional email secrets remain server-only", async () => {
  const env = await source(".env.example");
  assert.match(env, /RESEND_API_KEY=/);
  assert.match(env, /HOIKOS_EMAIL_FROM=/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_(?:RESEND|HOIKOS_EMAIL)/);
});
