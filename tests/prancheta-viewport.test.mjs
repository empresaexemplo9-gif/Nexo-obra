import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { criarVista, zoomNaVista, enquadrarElementos } = await vite.ssrLoadModule("/lib/prancheta-viewport.ts");
after(() => vite.close());

const parede = (a, b) => ({ id: "p1", camada: "layout", tipo: "parede", a, b, espessuraMm: 150 });

test("zoom mantém o ponto sob o cursor no mesmo lugar lógico", () => {
  const vista = criarVista(0, 0, 10_000);
  const antes = { x: 2_500, y: 2_500 };
  const depois = zoomNaVista(vista, 0.5, antes);
  assert.equal((antes.x - depois.x) / depois.largura, (antes.x - vista.x) / vista.largura);
  assert.equal((antes.y - depois.y) / (depois.largura * depois.proporcao), (antes.y - vista.y) / (vista.largura * vista.proporcao));
});

test("zoom inválido não altera a vista", () => {
  const vista = criarVista();
  assert.deepEqual(zoomNaVista(vista, 0, { x: 0, y: 0 }), vista);
  assert.deepEqual(zoomNaVista(vista, Number.NaN, { x: 0, y: 0 }), vista);
});

test("enquadramento inclui todo o desenho e margem", () => {
  const vista = enquadrarElementos([parede({ x: 1_000, y: 2_000 }, { x: 5_000, y: 2_000 })]);
  assert.ok(vista.x < 1_000);
  assert.ok(vista.x + vista.largura > 5_000);
  assert.ok(vista.y < 2_000);
  assert.ok(vista.y + vista.largura * vista.proporcao > 2_000);
});

test("enquadramento vazio volta para uma vista inicial segura", () => {
  assert.deepEqual(enquadrarElementos([]), criarVista());
});

test("desenho pequeno ocupa a vista sem margem mínima de milímetros", () => {
  const linha = { id: "l", camada: "layout", tipo: "traco", pontos: [{ x: 10, y: 10 }, { x: 30, y: 20 }], espessuraMm: 0.1 };
  const vista = enquadrarElementos([linha]);
  assert.ok(vista.largura < 40);
  assert.ok(vista.x < 10 && vista.x + vista.largura > 30);
});

test("zoom ultrapassa o antigo limite e mantém precisão e âncora", () => {
  let vista = criarVista(1000, 2000, 800);
  const ancora = { x: 1200, y: 2100 };
  for (let i = 0; i < 25; i++) vista = zoomNaVista(vista, 0.8, ancora);
  assert.ok(vista.largura < 4);
  assert.ok(vista.largura > 0);
  assert.ok(Math.abs((ancora.x - vista.x) / vista.largura - 0.25) < 1e-9);
});

test("enquadramento de ponto continua centrado quando atinge o limite", () => {
  const linha = { id: "l", camada: "layout", tipo: "traco", pontos: [{ x: 1000, y: 2000 }, { x: 1000, y: 2000 }], espessuraMm: 0 };
  const vista = enquadrarElementos([linha]);
  assert.equal(vista.x + vista.largura / 2, 1000);
  assert.equal(vista.y + vista.largura * vista.proporcao / 2, 2000);
});
