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
const { lerEnvelope, camposDoCorpo, lerValorBrasileiro: lerValorBrasileiroDireto } = await vite.ssrLoadModule("/lib/drap-envelope.ts");
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

// Valor escrito no financeiro oficial. A primeira versão tirava o ponto sempre, e
// "1500.50" virava 150050 — cento e cinquenta mil reais gravados na Drap por um
// lançamento de mil e quinhentos.
test("o ponto só é separador de milhar quando existe vírgula", () => {
  const lerValorBrasileiro = lerValorBrasileiroDireto;
  assert.equal(lerValorBrasileiro("1.234,56"), 1234.56, "formato brasileiro");
  assert.equal(lerValorBrasileiro("1500.50"), 1500.5, "ponto decimal não pode virar milhar");
  assert.equal(lerValorBrasileiro("1234,56"), 1234.56);
  assert.equal(lerValorBrasileiro("1234"), 1234);
  assert.equal(lerValorBrasileiro("R$ 89,90"), 89.9);
  assert.equal(lerValorBrasileiro("1.234.567,89"), 1234567.89);
  // Sem vírgula, grupos de três dígitos são milhar: "1.500" digitado como mil e quinhentos
  // virava R$ 1,50 na cobrança.
  assert.equal(lerValorBrasileiro("1.500"), 1500);
  assert.equal(lerValorBrasileiro("12.000"), 12000);
  assert.equal(lerValorBrasileiro("1.234.567"), 1234567);
  assert.equal(lerValorBrasileiro("1.5"), 1.5);
});

test("valor ilegível devolve nulo, nunca zero", () => {
  // Zero silencioso viraria lançamento de graça no sistema financeiro.
  for (const bruto of ["", "  ", "abc", "R$", "-"]) {
    assert.equal(lerValorBrasileiroDireto(bruto), null, `"${bruto}"`);
  }
});

test("array puro não declara total", () => {
  // O adaptador usa `total` como teto de paginação: dizer que o total é o tamanho da
  // página faria ele parar na primeira e descartar o resto sem avisar.
  assert.equal(lerEnvelope([{ id: "a" }, { id: "b" }]).total, null);
});
