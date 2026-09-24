import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { installDom, stubFetch } from "./dom-harness.mjs";

const dom = installDom();
const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { PranchetaStandalone } = await vite.ssrLoadModule("/components/prancheta-standalone.tsx");
const { PranchetaWorkspace } = await vite.ssrLoadModule("/components/prancheta-workspace.tsx");
const { documentoVazio } = await vite.ssrLoadModule("/lib/prancheta.ts");
after(async () => { await vite.close(); dom.cleanup(); });

const prancha = { id: "prancha-1", nome: "Planta", especie: "planta", revisao: 1,
  projectId: null, projectName: null, documento: documentoVazio(), atualizadoEm: "2026-09-20", autor: null };
const session = { authenticated: true, member: { permissions: { studio: { view: true, edit: true } } },
  terms: { accepted: true } };

function ponteiro(tipo, alvo) {
  const evento = new dom.window.Event(tipo, { bubbles: true });
  Object.defineProperty(evento, "pointerType", { value: "mouse" });
  alvo.dispatchEvent(evento);
}

function arrasto(tipo, alvo, x, y, botao = 0) {
  const evento = new dom.window.MouseEvent(tipo, { bubbles: true, button: botao, buttons: tipo === "pointerup" ? 0 : botao === 1 ? 4 : 1,
    clientX: x, clientY: y });
  Object.defineProperty(evento, "pointerId", { value: 1 });
  alvo.dispatchEvent(evento);
}

test("a lista abre cada desenho em outra aba", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const reactRoot = createRoot(container);
  stubFetch({ "/api/studio": { pranchas: [{ id: prancha.id, nome: prancha.nome,
    especie: prancha.especie, revisao: 1, projectId: null, projectName: null,
    projectCode: null, autor: null, criadoEm: "2026-09-20", atualizadoEm: "2026-09-20" }] } });
  await act(async () => { reactRoot.render(React.createElement(PranchetaWorkspace, { projects: [], query: "", canEdit: true })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  const link = container.querySelector('a[href="/prancheta/prancha-1"]');
  assert.equal(link?.getAttribute("target"), "_blank");
  assert.equal(link?.getAttribute("rel"), "noopener noreferrer");
  await act(async () => reactRoot.unmount()); container.remove();
});

test("editor amplo mostra ajuda após quatro segundos parados e esconde ao mover", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const reactRoot = createRoot(container);
  stubFetch({ "/api/session": session, "/api/studio/prancha-1": { prancha },
    "/api/studio/assets": { itens: [] }, "/api/usage": { beatMs: 30000 } });
  await act(async () => { reactRoot.render(React.createElement(PranchetaStandalone, { drawingId: prancha.id })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.ok(container.querySelector(".prancheta-autonoma .prancheta-ampla"));
  const selecionar = container.querySelector('button[aria-label="Selecionar (Esc)"]');
  assert.ok(selecionar);
  await act(async () => { ponteiro("pointerover", selecionar); });
  assert.equal(container.querySelector('[role="tooltip"]'), null);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 4100)); });
  assert.match(container.querySelector('[role="tooltip"]')?.textContent ?? "", /Segure o botão esquerdo/);
  await act(async () => { ponteiro("pointermove", selecionar); });
  assert.equal(container.querySelector('[role="tooltip"]'), null);
  await act(async () => reactRoot.unmount()); container.remove();
});

test("o botão do meio arrasta a vista até ser solto, como no AutoCAD", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const reactRoot = createRoot(container);
  stubFetch({ "/api/session": session, "/api/studio/prancha-1": { prancha },
    "/api/studio/assets": { itens: [] }, "/api/usage": { beatMs: 30000 } });
  globalThis.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } };
  await act(async () => { reactRoot.render(React.createElement(PranchetaStandalone, { drawingId: prancha.id })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  const svg = container.querySelector('svg[role="application"]');
  assert.ok(svg);
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  svg.getBoundingClientRect = () => ({ width: 1000, height: 620 });
  const antes = svg.getAttribute("viewBox");
  await act(async () => { arrasto("pointerdown", svg, 10, 10, 1); arrasto("pointermove", svg, 30, 10, 1); });
  const depois = svg.getAttribute("viewBox");
  assert.notEqual(depois, antes);
  await act(async () => { arrasto("pointerup", svg, 30, 10, 1); arrasto("pointermove", svg, 50, 10); });
  assert.equal(svg.getAttribute("viewBox"), depois, "soltar encerra a movimentação");
  await act(async () => reactRoot.unmount()); container.remove();
});

test("seleção move um elemento enquanto o botão esquerdo está pressionado", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const reactRoot = createRoot(container);
  const desenho = { ...prancha, documento: { ...documentoVazio(), elementos: [
    { id: "parede-1", camada: "layout", tipo: "parede", a: { x: 1000, y: 1000 },
      b: { x: 3000, y: 1000 }, espessuraMm: 150 },
  ] } };
  stubFetch({ "/api/session": session, "/api/studio/prancha-1": { prancha: desenho },
    "/api/studio/assets": { itens: [] }, "/api/usage": { beatMs: 30000 } });
  globalThis.DOMPoint = class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return this; } };
  await act(async () => { reactRoot.render(React.createElement(PranchetaStandalone, { drawingId: prancha.id })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  const svg = container.querySelector('svg[role="application"]');
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  svg.getBoundingClientRect = () => ({ width: 1000, height: 620 });
  const linha = () => svg.querySelector('line[stroke="#1C190F"]');
  assert.equal(linha()?.getAttribute("x1"), "1000");
  await act(async () => { arrasto("pointerdown", svg, 2000, 1000); arrasto("pointermove", svg, 2500, 1300); });
  assert.notEqual(linha()?.getAttribute("x1"), "1000");
  await act(async () => { arrasto("pointerup", svg, 2500, 1300); });
  await act(async () => reactRoot.unmount()); container.remove();
});
