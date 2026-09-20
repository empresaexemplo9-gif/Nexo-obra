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
