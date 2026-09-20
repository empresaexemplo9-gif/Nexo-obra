import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { documentoVazio } = await vite.ssrLoadModule("/lib/prancheta.ts");
const { executeCadCommand } = await vite.ssrLoadModule("/lib/cad-commands.ts");
const { detectCadFormat, exportNexo, importNexo } = await vite.ssrLoadModule("/lib/cad-formats.ts");
after(() => vite.close());

let sequence = 0;
const context = (document = documentoVazio(), selectedId = null) => ({ document, selectedId, layerId: "layout", createId: () => `cad-${++sequence}` });

test("linha de comando cria linha e círculo com milímetros fracionários", () => {
  const line = executeCadCommand("L 0,0 3150.5,0", context());
  assert.equal(line.document.elementos[0].b.x, 3150.5);
  const circle = executeCadCommand("C 100,200 42.25", context(line.document));
  assert.equal(circle.document.elementos[1].raioMm, 42.25);
});

test("copiar não substitui o elemento selecionado", () => {
  const line = executeCadCommand("L 0,0 1000,0", context());
  const copy = executeCadCommand("CO 250,0", context(line.document, line.selectedId));
  assert.equal(copy.document.elementos.length, 2);
  assert.notEqual(copy.document.elementos[0].id, copy.document.elementos[1].id);
  assert.equal(copy.document.elementos[1].a.x, 250);
});

test("formato é detectado pelo conteúdo antes da extensão", () => {
  const bytes = new TextEncoder().encode("0\nSECTION\n2\nHEADER\n");
  assert.equal(detectCadFormat("arquivo.dwg", bytes)?.id, "dxf");
});

test("documento Nexo faz ida e volta validada", () => {
  const original = documentoVazio();
  const serialized = exportNexo(original);
  assert.deepEqual(importNexo(serialized), original);
  assert.equal(detectCadFormat("sem-extensao", new TextEncoder().encode(serialized))?.id, "nexo");
});

test("comandos respeitam camadas bloqueadas e limites do documento", () => {
  const ctx = context();
  ctx.document.camadas[0].bloqueada = true;
  assert.throws(() => executeCadCommand("L 0,0 100,0", ctx), /bloqueada/);
  const line = executeCadCommand("L 0,0 100,0", context());
  line.document.camadas[0].bloqueada = true;
  assert.throws(() => executeCadCommand("M 10,0", context(line.document, line.selectedId)), /bloqueada/);
  assert.throws(() => executeCadCommand("C 0,0 1000001", context()), /limites/);
});

test("escala altera raio e centro e coordenadas positivas sobem no desenho", () => {
  const circle = executeCadCommand("C 100,200 42.25", context());
  assert.equal(circle.document.elementos[0].centro.y, -200);
  const scaled = executeCadCommand("SC 0,0 2", context(circle.document, circle.selectedId));
  assert.equal(scaled.document.elementos[0].raioMm, 84.5);
  assert.deepEqual(scaled.document.elementos[0].centro, { x: 200, y: -400 });
});
