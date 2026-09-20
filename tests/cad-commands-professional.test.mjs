import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { documentoVazio, elementoSchema } = await vite.ssrLoadModule("/lib/prancheta.ts");
const { executeCadCommand } = await vite.ssrLoadModule("/lib/cad-commands.ts");
after(() => vite.close());

let sequence = 0;
const context = (document = documentoVazio(), selectedId = null) => ({ document, selectedId, layerId: "layout", createId: () => `cad-${++sequence}` });

test("comandos profissionais criam polilinha, cota e paralela", () => {
  const linha = executeCadCommand("L 0,0 4000,0", context());
  const paralela = executeCadCommand("O 150", context(linha.document, linha.selectedId));
  assert.equal(paralela.document.elementos.length, 2);
  const cota = executeCadCommand("DIM 0,0 4000,0 300", context(paralela.document));
  assert.equal(cota.document.elementos.at(-1).tipo, "cota");
  const poly = executeCadCommand("PL 0,0 1000,0 1000,1000", context(cota.document));
  assert.equal(poly.document.elementos.at(-1).tipo, "traco");
  assert.equal(elementoSchema.safeParse(poly.document.elementos.at(-1)).success, true);
});

test("espelhar cria uma cópia e mantém o original", () => {
  const linha = executeCadCommand("L 1000,0 3000,0", context());
  const espelho = executeCadCommand("MI 0,0 0,1000", context(linha.document, linha.selectedId));
  assert.equal(espelho.document.elementos.length, 2);
  assert.deepEqual(espelho.document.elementos[1].a, { x: -1000, y: 0 });
  assert.deepEqual(espelho.document.elementos[0].a, { x: 1000, y: 0 });
});

test("aparar e estender usam um limite explícito", () => {
  const linha = executeCadCommand("L 0,0 4000,0", context());
  const aparada = executeCadCommand("TR 2500,-1000 2500,1000 3800,0", context(linha.document, linha.selectedId));
  assert.equal(aparada.document.elementos[0].b.x, 2500);
  const estendida = executeCadCommand("EX 6000,-1000 6000,1000 3900,0", context(aparada.document, aparada.selectedId));
  assert.equal(estendida.document.elementos[0].b.x, 6000);
});

test("comandos recusam geometria inválida e camada bloqueada", () => {
  const doc = documentoVazio();
  doc.camadas[0].bloqueada = true;
  assert.throws(() => executeCadCommand("PL 0,0 1000,0", context(doc)), /bloqueada/);
  assert.throws(() => executeCadCommand("DIM 0,0 0,0", context()), /DIM/);
});
