// A leitura da lista da Drap: o contrato publicado descreve os campos do lançamento, mas
// não o envelope da listagem. Assumir um formato e mostrar "nenhum lançamento" quando ele
// não bate esconderia o problema — foi assim que o hash e o SQLITE_UNKNOWN ficaram horas
// sem diagnóstico nesta plataforma.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { extrairLista } = await vite.ssrLoadModule("/components/drap-lancamentos.tsx");
after(() => vite.close());

const item = { id: "a1", descricao: "Venda site", tipo: "receita", valor: 1500, status: "pago" };

test("aceita as formas de envelope que a Drap pode usar", () => {
  for (const corpo of [[item], { data: [item] }, { lancamentos: [item] }, { items: [item] }, { results: [item] }, { records: [item] }]) {
    const lido = extrairLista(corpo);
    assert.ok("itens" in lido, `envelope recusado: ${JSON.stringify(corpo).slice(0, 40)}`);
    assert.equal(lido.itens[0].id, "a1");
  }
});

test("lista vazia é lista vazia, não erro", () => {
  const lido = extrairLista({ data: [] });
  assert.deepEqual(lido, { itens: [] });
});

test("formato não previsto vira erro que mostra os campos recebidos", () => {
  // Sem isto, a tela diria "nenhum lançamento" e esconderia que o contrato mudou.
  const lido = extrairLista({ resultado: { linhas: [item] }, total: 1 });
  assert.ok("erro" in lido);
  assert.match(lido.erro, /formato não previsto/);
  assert.match(lido.erro, /resultado/);
  assert.match(lido.erro, /total/);
});

test("corpo vazio ou nulo também é relatado", () => {
  assert.ok("erro" in extrairLista(null));
  assert.ok("erro" in extrairLista(undefined));
  assert.ok("erro" in extrairLista("texto solto"));
});
