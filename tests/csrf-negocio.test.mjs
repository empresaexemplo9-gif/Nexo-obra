import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// A trava contra requisição de outro site vivia só nas rotas administrativas. Orçamento,
// CRM, obra, planilha e financeiro dependiam apenas do SameSite do cookie. Agora ela fica em
// requireOrganizationContext, por onde passa toda escrita de dado de negócio.

const root = fileURLToPath(new URL("..", import.meta.url));
globalThis.__platformEnvOverride = {};
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { requireOrganizationContext } = await vite.ssrLoadModule("/lib/server/backend.ts");
after(() => vite.close());

const pedido = (method, headers) => new Request("https://plataforma.test/api/budgets", { method, headers });

test("escrita vinda de outro site é recusada antes de ler a sessão", async () => {
  for (const headers of [{ Origin: "https://malicioso.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      await assert.rejects(requireOrganizationContext(pedido(method, headers)), (erro) => erro.code === "cross_site_request" && erro.status === 403, `${method} ${JSON.stringify(headers)}`);
    }
  }
});

test("escrita do próprio site e leitura seguem para a autenticação", async () => {
  for (const request of [pedido("POST", { Origin: "https://plataforma.test" }), pedido("POST", {}), pedido("GET", { Origin: "https://malicioso.example" })]) {
    await assert.rejects(requireOrganizationContext(request), (erro) => erro.code !== "cross_site_request", `${request.method} ${request.headers.get("origin")}`);
  }
});
