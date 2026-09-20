import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const core = await vite.ssrLoadModule("/packages/cad-core/index.ts");
const formats = await vite.ssrLoadModule("/lib/cad-formats.ts");
const { executeCadCommand: execute } = await vite.ssrLoadModule("/lib/cad-commands.ts");
const { documentoVazio } = await vite.ssrLoadModule("/lib/prancheta.ts");
const { exportarDxf } = await vite.ssrLoadModule("/lib/integrations/dxf.ts");
const { encaixePerto } = await vite.ssrLoadModule("/lib/prancheta-cad.ts");
const { moverElemento } = await vite.ssrLoadModule("/lib/prancheta.ts");
after(() => vite.close());
const bytes = (text) => new TextEncoder().encode(text);
let next = 0;
const id = () => `test-${++next}`;
const run = (doc, command, selection = null) => execute(doc, command, selection, id);

test("new snaps respect circle geometry, arc sweep and locked layers", () => {
  const r = run(documentoVazio(), "C 0,0 1000");
  const q = encaixePerto(r.document, { x: 0, y: 990 }, { toleranciaMm: 20, ativos: ["quadrante"] });
  assert.deepEqual(q.ponto, { x: 0, y: 1000 });
  const t = encaixePerto(r.document, { x: 500, y: 866 }, { origem: { x: 2000, y: 0 }, toleranciaMm: 20, ativos: ["tangente"] });
  assert.equal(t.tipo, "tangente");
  assert.ok(Math.abs(Math.hypot(t.ponto.x, t.ponto.y) - 1000) < 1e-9);
  const arc = { ...r.document, elementos: [{ ...r.document.elementos[0], varreduraGraus: 90 }] };
  assert.equal(encaixePerto(arc, { x: -1000, y: 0 }, { toleranciaMm: 20, ativos: ["quadrante"] }).tipo, "malha");
  const locked = { ...r.document, camadas: r.document.camadas.map(c => ({ ...c, bloqueada: true })) };
  assert.equal(encaixePerto(locked, { x: 0, y: 990 }, { toleranciaMm: 20, ativos: ["quadrante"] }).tipo, "malha");
});
test("drag translation keeps fractional geometry rigid", () => {
  const line = run(documentoVazio(), "L 0.125,0.25 1000.75,100.5").document.elementos[0];
  const moved = moverElemento(line, 113, 190, 100);
  assert.equal(moved.pontos[1].x - moved.pontos[0].x, line.pontos[1].x - line.pontos[0].x);
  assert.equal(moved.pontos[0].x, 100.125);
});

test("rectangle, polygon, ellipse and arc create valid closed and curved geometry", () => {
  let r = run(documentoVazio(), "REC 0,0 4000,3000");
  assert.equal(r.document.elementos[0].pontos.length, 5);
  r = run(r.document, "POL 6 0,0 1000");
  assert.equal(r.document.elementos[1].pontos.length, 7);
  r = run(r.document, "EL 0,0 2000 1000");
  assert.equal(r.document.elementos[2].pontos.length, 129);
  assert.match(r.message, /aproximada/);
  r = run(r.document, "A 0,0 1000.5 22.5 90.5");
  assert.equal(r.document.elementos[3].inicioGraus, 22.5);
  assert.throws(() => run(r.document, "REC 0,0 0,1000"));
  assert.throws(() => run(r.document, "POL 1001 0,0 1000"));
});
test("rectangular and polar arrays are bounded transactions with unique ids", () => {
  let r = run(documentoVazio(), "L 1000,0 2000,0");
  r = run(r.document, "AP 4 0,0 360", r.selectedId);
  assert.equal(r.document.elementos.length, 4);
  assert.ok(Math.abs(r.document.elementos[1].pontos[0].y + 1000) < 1e-9);
  r = run(r.document, "AR 3 2 1000 2000", r.selectedId);
  assert.equal(r.document.elementos.length, 9);
  assert.equal(new Set(r.document.elementos.map(e => e.id)).size, 9);
  assert.throws(() => run(r.document, "AR 500 1 1 1", r.selectedId));
  assert.throws(() => run(r.document, "AR 2 2 0 1", r.selectedId));
  r = run(r.document, "E", r.selectedId);
  assert.equal(r.document.elementos.length, 8);
  assert.equal(r.selectedId, null);
});

test("CAD line, relative polyline, circle, dimension and text preserve coordinates", () => {
  let result = run(documentoVazio(), "L 0.125,0 3000.25,0");
  assert.equal(result.document.elementos[0].pontos[0].x, 0.125);
  result = run(result.document, "PL 0,0 @3000,0 @0,2000");
  assert.deepEqual(result.document.elementos[1].pontos.at(-1), { x: 3000, y: -2000 });
  result = run(result.document, "C 1000,1000 500");
  assert.equal(result.document.elementos[2].raioMm, 500);
  result = run(result.document, "DIM 0,0 3000,0 500");
  result = run(result.document, "T 0,0 200 Sala de estar");
  assert.equal(result.document.elementos[4].texto, "Sala de estar");
});
test("CAD move/copy/rotate/scale operate on the selected geometry", () => {
  let r = run(documentoVazio(), "L 0,0 1000,0");
  r = run(r.document, "M @200,500", r.selectedId);
  assert.deepEqual(r.document.elementos[0].pontos[0], { x: 200, y: -500 });
  r = run(r.document, "CO @0,500", r.selectedId);
  assert.equal(r.document.elementos.length, 2);
  r = run(r.document, "RO 90 0,0", r.selectedId);
  assert.ok(Math.abs(r.document.elementos[1].pontos[0].x + 1000) < 1e-9);
  r = run(r.document, "SC 2 0,0", r.selectedId);
  assert.ok(Math.abs(r.document.elementos[1].pontos[0].x + 2000) < 1e-9);
});
test("CAD commands reject invalid, out of bounds and locked edits atomically", () => {
  const r = run(documentoVazio(), "L 0,0 1000,0");
  const locked = { ...r.document, camadas: r.document.camadas.map((c) => ({ ...c, bloqueada: true })) };
  for (const cmd of ["M @1,1", "CO @1,1", "RO 90 0,0", "SC 2 0,0", "MI 0,0 0,1", "O 100"]) assert.throws(() => run(locked, cmd, r.selectedId), /bloqueada/);
  for (const cmd of ["L 0,0", "C 0,0 -1", "SC -1 0,0", "L 0,0 1e99,0", "L 0,0 1,1 ignored", "SC 2 0,0 ignored", "XYZ"]) assert.throws(() => run(r.document, cmd, r.selectedId));
  assert.equal(r.document.elementos.length, 1);
});
test("Native file round trips geometry and detects content with no extension", async () => {
  const r = run(documentoVazio(), "L 0.125,0 500,500");
  const input = bytes(formats.exportNative(r.document));
  const registry = formats.createFormatRegistry();
  assert.equal(registry.detect(input).id, "nexo");
  const imported = await registry.import(input);
  assert.deepEqual(imported.elementos, r.document.elementos);
  assert.equal(imported.report.discarded, 0);
});
test("Import merge remaps element AND layer ids, retains locked layers, can import twice", async () => {
  const r = run(documentoVazio(), "L 0,0 500,0");
  const imported = await formats.createFormatRegistry().import(bytes(formats.exportNative(r.document)));
  const locked = { ...r.document, camadas: r.document.camadas.map((c) => ({ ...c, bloqueada: true })) };
  const first = formats.mergeCadImport(locked, imported, id);
  const second = formats.mergeCadImport(first, imported, id);
  assert.equal(second.elementos.length, 3);
  assert.equal(new Set(second.elementos.map((e) => e.id)).size, 3);
  assert.notEqual(second.elementos[0].camada, second.elementos[1].camada);
  assert.equal(second.camadas[0].bloqueada, true);
});
test("Invalid native versions, missing layers and foreign media are rejected", async () => {
  const registry = formats.createFormatRegistry();
  const doc = run(documentoVazio(), "L 0,0 500,0").document;
  const envelope = JSON.parse(formats.exportNative(doc));
  await assert.rejects(registry.import(bytes(JSON.stringify({ ...envelope, version: 99 }))), /versão/);
  const foreign = { ...envelope, document: { ...doc, fundo: { chave: "https://other.example/private.png", nome: "foreign", larguraMm: 1000, alturaMm: 1000, opacidade: 50 } } };
  await assert.rejects(registry.import(bytes(JSON.stringify(foreign))), /privadas/);
  await assert.rejects(registry.import(bytes(JSON.stringify({ ...envelope, document: { ...doc, elementos: [{ ...doc.elementos[0], camada: "missing" }] } }))), /sem camada/);
  await assert.rejects(registry.import(new Uint8Array()), /vazio/);
  await assert.rejects(registry.import(new Uint8Array(formats.MAX_CAD_BYTES + 1)), /12 MB/);
  await assert.rejects(registry.import(bytes("<svg onload='evil()'></svg>")), /não reconhecido/);
});
test("DXF content and DWG conversion share the import report pipeline", async () => {
  const doc = run(documentoVazio(), "L 0,0 3000,0").document;
  const dxf = exportarDxf(doc, { visiveis: doc.elementos });
  const imported = await formats.createFormatRegistry().import(bytes(dxf));
  assert.equal(imported.report.format, "dxf");
  assert.equal(imported.elementos.length, 1);
  const dwg = bytes("AC1032example");
  await assert.rejects(formats.createFormatRegistry().import(dwg), /não configurado/);
  const converted = await formats.createFormatRegistry(async () => dxf).import(dwg);
  assert.equal(converted.report.format, "dwg");
  assert.match(converted.avisos[0], /convertido/);
});
test("Geometry keeps double precision and transactions preserve history on errors", () => {
  const p = core.transform({ x: 0.125, y: 0.25 }, core.scaling(2, { x: 0, y: 0 }));
  assert.deepEqual(p, { x: 0.25, y: 0.5 });
  assert.deepEqual(core.nearestOnSegment({ x: 2, y: 2 }, { x: 0, y: 0 }, { x: 1, y: 0 }), { x: 1, y: 0 });
  assert.equal(core.tangentPoints({ x: 0, y: 0 }, { x: 0, y: 0 }, 1).length, 0);
  const tangent = core.tangentPoints({ x: 2, y: 0 }, { x: 0, y: 0 }, 1);
  assert.equal(tangent.length, 2);
  assert.ok(Math.abs(Math.hypot(tangent[0].x, tangent[0].y) - 1) < 1e-12);
  const history = new core.CommandHistory(0);
  for (let i = 0; i < 100; i++) history.execute((n) => n + 1);
  assert.throws(() => history.execute(() => { throw new Error("failed"); }));
  assert.equal(history.current, 100);
  for (let i = 0; i < 100; i++) history.undo();
  assert.equal(history.current, 0);
  history.redo(); history.execute((n) => n + 5);
  assert.equal(history.canRedo, false);
  assert.equal(history.current, 6);
});
