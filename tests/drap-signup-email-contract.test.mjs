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

test("H.OIKOS activates DRAP only after the operational API validates the tenant", async () => {
  const connection = await source("app/api/integrations/drap/connection/route.ts");
  assert.match(connection, /requestDrapApi\(externalCompanyId, "\/api\/v1\/lancamentos\?limit=1&offset=0"\)/);
  assert.match(connection, /status: "active"/);
  assert.match(connection, /status: "pending"/);
  assert.doesNotMatch(connection, /sendReadyNotifications|sendDrapReadyEmail|transactionalEmailConfigured|drap_ready_notification/);
});

test("solutions screen redirects to DRAP signup and confirms activation inside H.OIKOS", async () => {
  const ui = await source("components/drap-solutions-workspace.tsx");
  assert.match(ui, /\/api\/integrations\/drap\/signup/);
  assert.match(ui, /window\.location\.assign\(body\.redirectUrl\)/);
  assert.match(ui, /Criar conta DRAP/);
  assert.match(ui, /DRAP conectada à H\.OIKOS/);
  assert.doesNotMatch(ui, /e-mail|email|MailCheck|Brevo|Resend/);
});

test("project no longer configures a transactional email provider for the DRAP flow", async () => {
  const env = await source(".env.example");
  assert.doesNotMatch(env, /BREVO_API_KEY|HOIKOS_EMAIL_FROM|RESEND_API_KEY/);
});
