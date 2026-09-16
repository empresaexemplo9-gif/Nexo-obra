import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return readFile(`${root}/${path}`, "utf8");
}

test("homologa o envelope e a assinatura oficiais do webhook Drap", async () => {
  const webhook = await source("app/api/integrations/drap/webhook/route.ts");
  const processor = await source("lib/server/drap-events.ts");

  assert.match(webhook, /x-drap-timestamp/);
  assert.match(webhook, /x-drap-signature/);
  assert.match(webhook, /MAX_CLOCK_SKEW_SECONDS = 300/);
  assert.match(webhook, /`\$\{timestamp\}\.\$\{payload\}`/);
  assert.match(webhook, /payload\.event/);
  assert.match(webhook, /payload\.timestamp/);
  assert.match(webhook, /sha256Hex\(`/);
  assert.match(webhook, /onConflictDoNothing/);
  assert.doesNotMatch(webhook, /company_id/);

  assert.match(processor, /SELECT id, event_type, payload, status FROM integration_events/);
  assert.match(processor, /data\.lancamento/);
  assert.match(processor, /cobranca\./);
  assert.doesNotMatch(processor, /payload_json/);
});

test("usa a API tenant-scoped de lancamentos sem enviar company_id", async () => {
  const adapter = await source("lib/integrations/drap.ts");

  assert.match(adapter, /DRAP_TENANTS_JSON/);
  assert.match(adapter, /apiTokenFor\(externalCompanyId/);
  assert.match(adapter, /webhookSecret/);
  assert.match(adapter, /\/api\/v1\/lancamentos/);
  assert.match(adapter, /searchParams\.set\("limit", "100"\)/);
  assert.match(adapter, /searchParams\.set\("offset", String\(offset\)\)/);
  assert.match(adapter, /contraparte/);
  assert.doesNotMatch(adapter, /searchParams\.set\("company_id"/);
  assert.doesNotMatch(adapter, /company_id: input\.externalCompanyId/);
});

test("falha fechado quando o segredo não identifica um único tenant", async () => {
  const webhook = await source("app/api/integrations/drap/webhook/route.ts");

  assert.match(webhook, /matched\.length === 0/);
  assert.match(webhook, /matched\.length > 1/);
  assert.match(webhook, /Ambiguous Drap webhook secret/);
  assert.match(webhook, /Ambiguous Drap tenant configuration/);
  assert.match(webhook, /externalCompanyId, tenantCompanyId/);
});
