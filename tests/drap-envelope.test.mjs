// Regra única de leitura do envelope da Drap, compartilhada entre o adaptador do servidor
// e a tela. Antes estava escrita duas vezes dentro do adaptador e uma terceira, mais
// fraca, no componente — e três cópias divergem. A do componente não cobria `data.items`
// nem `transactions`, que a Drap usa.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { lerEnvelope, camposDoCorpo } = await vite.ssrLoadModule("/lib/drap-envelope.ts");
after(() => vite.close());

const item = { id: "a1", descricao: "Venda", valor: 1500 };

test("o envelope confirmado na homologação é lido com o total", () => {
  // `{ items, total }` — confirmado contra a API real pelo roteiro de homologação.
  const lido = lerEnvelope({ items: [item], total: 340 });
  assert.equal(lido.itens.length, 1);
  assert.equal(lido.total, 340, "o total declarado precisa sobreviver: sem ele a tela mostra 50 de mil como se fossem todos");
});

test("as demais formas observadas continuam aceitas", () => {
  for (const corpo of [[item], { transactions: [item] }, { results: [item] }, { lancamentos: [item] }, { data: [item] }, { data: { items: [item] } }]) {
    const lido = lerEnvelope(corpo);
    assert.ok(lido, `forma recusada: ${JSON.stringify(corpo).slice(0, 44)}`);
    assert.equal(lido.itens[0].id, "a1");
  }
});

test("total em texto é convertido; total inválido não vira zero", () => {
  assert.equal(lerEnvelope({ items: [item], total: "42" }).total, 42);
  assert.equal(lerEnvelope({ items: [item], total: "muitos" }).total, null, "texto inválido não pode virar total 0");
  assert.equal(lerEnvelope({ items: [item], total: -5 }).total, null);
});

test("lista vazia é lista vazia, e formato irreconhecível é nulo", () => {
  assert.deepEqual(lerEnvelope({ items: [], total: 0 }), { itens: [], total: 0 });
  // Distinguir os dois é o ponto: tratar "não reconheci" como "vazio" foi o que escondeu
  // o financeiro por obra voltando sem nada, com a integração funcionando.
  assert.equal(lerEnvelope({ resultado: { linhas: [item] } }), null);
  assert.equal(lerEnvelope(null), null);
  assert.equal(lerEnvelope("texto"), null);
});

test("os campos do corpo ficam disponíveis para a mensagem de erro", () => {
  assert.deepEqual(camposDoCorpo({ resultado: 1, total: 2 }), ["resultado", "total"]);
  assert.deepEqual(camposDoCorpo([1, 2]), []);
  assert.deepEqual(camposDoCorpo(null), []);
});
