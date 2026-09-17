import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(`${root}/${path}`, "utf8");
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const resources = await vite.ssrLoadModule("/lib/server/drap-resources.ts");
test.after(() => vite.close());

globalThis.__platformEnvOverride = {
  DRAP_API_URL: "https://empresa.drap.app.br",
  DRAP_API_TOKEN: "drap_live_credencial_de_teste",
};

const fetchOriginal = globalThis.fetch;
test.after(() => { globalThis.fetch = fetchOriginal; });

function respostas(statusPorCaminho) {
  const chamadas = [];
  globalThis.fetch = async (url) => {
    const alvo = new URL(url);
    chamadas.push(alvo.pathname);
    const status = statusPorCaminho[alvo.pathname] ?? 404;
    return new Response(JSON.stringify({ ok: status < 400 }), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return chamadas;
}

test("descobre alias real de NFS-e sem inventar sucesso no primeiro 404", async () => {
  const chamadas = respostas({
    "/api/v1/nfse": 404,
    "/api/v1/notas-fiscais": 405,
  });

  const probe = await resources.probeDrapResource("tenant-nfse-alias", "nfse", true);

  assert.equal(probe.status, "available");
  assert.equal(probe.path, "/api/v1/notas-fiscais");
  assert.deepEqual(chamadas, ["/api/v1/nfse", "/api/v1/notas-fiscais"]);
});

test("403 significa recurso existente sem escopo e não tenta outro alias", async () => {
  const chamadas = respostas({ "/api/v1/nfse": 403, "/api/v1/notas-fiscais": 200 });

  const probe = await resources.probeDrapResource("tenant-nfse-sem-escopo", "nfse", true);

  assert.equal(probe.status, "forbidden");
  assert.equal(probe.path, "/api/v1/nfse");
  assert.deepEqual(chamadas, ["/api/v1/nfse"]);
});

test("todos os aliases 404 viram missing", async () => {
  respostas({});

  const probe = await resources.probeDrapResource("tenant-nfse-ausente", "nfse", true);

  assert.equal(probe.status, "missing");
  assert.equal(probe.path, null);
});

test("a ponte operacional é allowlist e exige idempotência para escrita", async () => {
  const route = await source("app/api/integrations/drap/resources/[resource]/[[...segments]]/route.ts");
  const resolver = await source("lib/server/drap-resources.ts");

  assert.match(route, /isDrapResource\(route\.resource\)/);
  assert.match(route, /requireDrapResourcePath/);
  assert.match(route, /operationalDrapContext/);
  assert.match(route, /chaveIdempotenciaDe/);
  assert.match(route, /idempotency_key_required/);
  assert.doesNotMatch(route, /DRAP_API_TOKEN|Authorization/);
  assert.match(resolver, /\/api\/v1\/cobrancas/);
  assert.match(resolver, /\/api\/v1\/nfse/);
  assert.match(resolver, /WRITABLE_RESOURCES/);
});

test("cobrança usa rota descoberta e mantém a chave até a chamada remota", async () => {
  const charges = await source("app/api/integrations/drap/charges/route.ts");
  const connection = await source("app/api/integrations/drap/connection/route.ts");

  assert.match(charges, /requireDrapResourcePath\(connection\.external_company_id, "cobrancas"\)/);
  assert.match(charges, /idempotencyKey: data\.idempotencyKey/);
  assert.match(charges, /requestDrapApi/);
  assert.doesNotMatch(charges, /isDrapChargesConfigured/);
  assert.match(connection, /probeDrapResource\(connection\.external_company_id, "cobrancas"\)/);
});
