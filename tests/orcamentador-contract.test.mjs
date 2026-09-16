import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {
  SINAPI_API_URL: "https://orcamentador.test/api",
  SINAPI_API_TOKEN: "test-api-key",
  SINAPI_API_KEY_HEADER: "X-API-Key",
  SINAPI_SEARCH_PATH: "/insumos",
};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const integration = await vite.ssrLoadModule("/lib/integrations/orcamentador.ts");

const originalFetch = globalThis.fetch;
let requests = [];

function response(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    requests.push({ url, headers: new Headers(init.headers) });
    if (url.pathname.endsWith("/insumos")) {
      return response({ items: [{ codigo: "100", descricao: "Cimento", unidade: "kg", preco: "10,50", preco_naodesonerado: "10,50" }], pagination: { total_pages: 1 } });
    }
    if (url.pathname.endsWith("/composicoes")) {
      return response({ items: [{ codigo: "200", descricao: "Alvenaria", unidade: "m2", preco: "25,00", preco_naodesonerado: "25,00" }], pagination: { total_pages: 1 } });
    }
    if (url.pathname.endsWith("/encargos")) return response({ estado: "GO", total: 1 });
    if (url.pathname.endsWith("/indicadores")) return response({ incc: 1 });
    return new Response(JSON.stringify({ erro: "rota inesperada" }), { status: 404, headers: { "content-type": "application/json" } });
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  delete globalThis.__platformEnvOverride;
  await vite.close();
});

const profile = { uf: "GO", regime: "NaoDesonerado", automatico: false, mapas: [], assinaturas: [] };

test("snapshot mensal usa apenas parâmetros aceitos e paginação máxima de 100", async () => {
  const result = await integration.fetchOrcamentadorMonthlySnapshot(profile, "2026-08");
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.tipo).sort(), ["composicao", "insumo"]);
  assert.equal(result.items.find((item) => item.codigo === "100").custoUnitarioCentavos, 1050);

  const tables = requests.filter(({ url }) => /\/(insumos|composicoes)$/.test(url.pathname));
  assert.equal(tables.length, 2);
  for (const { url, headers } of tables) {
    assert.equal(url.searchParams.get("estado"), "GO");
    assert.equal(url.searchParams.get("regime"), "NAO_DESONERADO");
    assert.equal(url.searchParams.get("data_ref"), "2026-08-01");
    assert.equal(url.searchParams.get("limit"), "100");
    assert.equal(url.searchParams.get("sort"), "codigo");
    assert.equal(url.searchParams.get("order"), "asc");
    assert.equal(url.searchParams.has("referencia"), false, "não envia parâmetro fora do contrato");
    assert.equal(headers.get("X-API-Key"), "test-api-key");
  }

  const encargos = requests.find(({ url }) => url.pathname.endsWith("/encargos"));
  assert.ok(encargos, "encargos fazem parte do snapshot");
  assert.equal(encargos.url.searchParams.get("estado"), "GO");
  assert.equal(encargos.url.searchParams.get("data_ref"), "2026-08-01", "encargos recebem a mesma competência");
});

test("busca consulta insumos e composições sem parâmetros obsoletos", async () => {
  const items = await integration.searchOrcamentadorItems("cimento", "GO", "2026-08", "NaoDesonerado");
  assert.equal(items.length, 2, "a busca geral não perde composições");
  assert.deepEqual(items.map((item) => item.tipo).sort(), ["composicao", "insumo"]);

  const searches = requests.filter(({ url }) => /\/(insumos|composicoes)$/.test(url.pathname));
  assert.equal(searches.length, 2);
  for (const { url } of searches) {
    assert.equal(url.searchParams.get("nome"), "cimento");
    assert.equal(url.searchParams.get("modo_busca"), "contem");
    assert.equal(url.searchParams.get("estado"), "GO");
    assert.equal(url.searchParams.get("data_ref"), "2026-08-01");
    assert.ok(Number(url.searchParams.get("limit")) <= 100);
    assert.equal(url.searchParams.has("referencia"), false);
  }
});
