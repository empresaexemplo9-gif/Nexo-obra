import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(`${root}/${path}`, "utf8");

test("proxies only the documented Drap operational endpoints", async () => {
  const lancamentos = await source("app/api/integrations/drap/lancamentos/route.ts");
  const lancamento = await source("app/api/integrations/drap/lancamentos/[id]/route.ts");
  const parceiros = await source("app/api/integrations/drap/parceiros/route.ts");
  const parceiro = await source("app/api/integrations/drap/parceiros/[id]/route.ts");
  const categorias = await source("app/api/integrations/drap/categorias/route.ts");

  assert.match(lancamentos, /\/api\/v1\/lancamentos/);
  for (const filter of ["tipo", "status", "data_de", "data_ate", "limit", "offset"]) assert.match(lancamentos, new RegExp(`\\"${filter}\\"`));
  for (const method of ["GET", "PATCH", "DELETE"]) assert.match(lancamento, new RegExp(`export async function ${method}`));

  assert.match(parceiros, /\/api\/v1\/parceiros/);
  for (const filter of ["tipo", "ativo", "limit", "offset"]) assert.match(parceiros, new RegExp(`\\"${filter}\\"`));
  for (const method of ["GET", "PATCH", "DELETE"]) assert.match(parceiro, new RegExp(`export async function ${method}`));

  assert.match(categorias, /\/api\/v1\/categorias/);
  assert.match(categorias, /export async function GET/);
  assert.match(categorias, /export async function POST/);
});

test("keeps Drap credentials server-side and tenant-scoped", async () => {
  const adapter = await source("lib/integrations/drap.ts");
  const proxy = await source("lib/server/drap-operational.ts");

  assert.match(adapter, /DRAP_TENANTS_JSON/);
  assert.match(adapter, /Authorization/);
  assert.match(adapter, /Retry-After|retry-after/);
  assert.doesNotMatch(adapter, /NEXT_PUBLIC_DRAP_API/);
  assert.match(proxy, /requireActiveDrapConnection/);
  assert.match(proxy, /requireModulePermission/);
  assert.match(proxy, /drap_rate_limited/);
  assert.match(proxy, /drap_scope_insufficient/);
});
