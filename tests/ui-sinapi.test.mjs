import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { installDom, stubFetch, findByText, textOf } from "./dom-harness.mjs";
const dom = installDom("https://platform.test/superadmin");
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { SinapiControl } = await vite.ssrLoadModule("/components/sinapi-control.tsx");
let container; let reactRoot;
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); };
afterEach(async () => { if (reactRoot) await act(async () => reactRoot.unmount()); container?.remove(); });
after(async () => { await vite.close(); dom.cleanup(); });
async function render(snapshot) {
  const calls = stubFetch({ "/api/superadmin/sinapi": snapshot });
  container = document.createElement("div"); document.body.append(container); reactRoot = createRoot(container);
  await act(async () => reactRoot.render(React.createElement(SinapiControl))); await settle(); return calls;
}
const empty = { config: null, jobs: [], storageConfigured: true, schedulerConfigured: true };
test("SINAPI vazia mostra configuração com controles rotulados e sem preços fictícios", async () => {
  await render(empty); assert.match(textOf(container), /Nenhuma referência ativa/);
  for (const control of container.querySelectorAll("input,select")) assert.ok(control.closest("label"), "controle precisa de label");
  assert.ok(findByText(container, "Preparar referência"));
});
test("aprovação exige a conferência explícita e envia a ação ao servidor", async () => {
  const snapshot = { ...empty, jobId: "job", jobs: [{ id: "job", competencia: "2026-04", uf: "SP", regime: "NaoDesonerado", estado: "pendente", total_itens: 100, origem_url: "https://www.caixa.gov.br/Downloads/sinapi.zip", report: { cursor: 100, amostra: [{ codigo: "1", descricao: "Teste", unidade: "M2", custoUnitarioCentavos: 123456, tipo: "insumo" }] } }] };
  const calls = await render(snapshot);
  const button = findByText(container, "Ativar e substituir"); assert.equal(button.disabled, true);
  await act(async () => container.querySelector('input[type="checkbox"]').click()); assert.equal(button.disabled, false);
  await act(async () => button.click()); await settle();
  assert.deepEqual(calls.find((c) => c.method === "POST").body, { action: "approve", confirmed: true });
});
test("falha de leitura fica visível e permite tentar carregar novamente", async () => {
  await render({ __status: 503, error: "Banco precisa de atualização." });
  assert.match(container.querySelector('[role="alert"]').textContent, /Banco precisa/);
  assert.ok(findByText(container, "Carregar referências"));
});
