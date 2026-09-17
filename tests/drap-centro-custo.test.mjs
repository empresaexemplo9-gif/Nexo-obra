import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const drap = await vite.ssrLoadModule("/lib/integrations/drap.ts");
test.after(() => vite.close());

const source = (path) => readFile(`${root}/${path}`, "utf8");

globalThis.__platformEnvOverride = {
  DRAP_API_URL: "https://empresa.drap.app.br",
  DRAP_API_TOKEN: "drap_live_credencial_de_teste",
};

const fetchOriginal = globalThis.fetch;
test.after(() => { globalThis.fetch = fetchOriginal; });

/** Troca o fetch por uma Drap de mentira e guarda as URLs que foram chamadas. */
function drapFalsa(resposta) {
  const chamadas = [];
  globalThis.fetch = async (url) => {
    chamadas.push(new URL(url));
    return new Response(JSON.stringify(resposta), { status: 200, headers: { "content-type": "application/json" } });
  };
  return chamadas;
}

function lancamento(extra) {
  return { id: "1", data: "2026-09-01", descricao: "Medição 1", tipo: "receita", valor: 1000, status: "em_aberto", contraparte: "Cliente", centro_custo: null, ...extra };
}

test("o recorte por obra vai no servidor e volta mapeado", async () => {
  const chamadas = drapFalsa({ items: [lancamento({ centro_custo: "hoikos:obra-1" })], total: 1 });

  const contas = await drap.fetchDrapTransactions("empresa-1", "hoikos:obra-1");

  assert.equal(chamadas[0].searchParams.get("centro_custo"), "hoikos:obra-1");
  assert.equal(contas.length, 1);
  // `centro_custo` é o nome que a Drap devolve. Enquanto o adaptador procurava
  // só `costCenterId`, isto vinha null e o recorte por obra dava vazio sempre.
  assert.equal(contas[0].costCenterId, "hoikos:obra-1");
  assert.equal(contas[0].amount, 1000);
});

test("servidor que ignora o filtro não vira financeiro da empresa na tela da obra", async () => {
  // É o que a Drap fazia antes do filtro existir: 200 com a lista inteira.
  drapFalsa({
    items: [
      lancamento({ id: "1", centro_custo: "hoikos:obra-1" }),
      lancamento({ id: "2", centro_custo: "hoikos:obra-2" }),
      lancamento({ id: "3", centro_custo: null }),
    ],
    total: 3,
  });

  const contas = await drap.fetchDrapTransactions("empresa-1", "hoikos:obra-1");

  assert.deepEqual(contas.map((item) => item.id), ["1"]);
});

test("sem obra selecionada não manda o filtro e traz a empresa inteira", async () => {
  const chamadas = drapFalsa({ items: [lancamento({ id: "1" }), lancamento({ id: "2" })], total: 2 });

  const contas = await drap.fetchDrapTransactions("empresa-1");

  assert.equal(chamadas[0].searchParams.has("centro_custo"), false);
  assert.equal(contas.length, 2);
});

test("a sondagem de lançamentos da empresa não pagina nada", async () => {
  const chamadas = drapFalsa({ items: [lancamento({ id: "1" })], total: 7 });

  assert.equal(await drap.hasAnyDrapTransaction("empresa-1"), true);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].searchParams.get("limit"), "1");

  drapFalsa({ items: [], total: 0 });
  assert.equal(await drap.hasAnyDrapTransaction("empresa-1"), false);
});

test("lista vazia na obra distingue obra parada de vínculo errado", async () => {
  const rota = await source("app/api/integrations/drap/transactions/route.ts");

  assert.match(rota, /cost_center_without_match/);
  assert.match(rota, /company_without_transactions/);
  assert.match(rota, /hasAnyDrapTransaction/);
  // A permissão continua sendo resolvida no servidor, por organização.
  assert.match(rota, /requireModulePermission\(context, "finance", "view"\)/);
  assert.match(rota, /project_cost_center_required/);
});

test("a tela diz qual é o caso em vez de listar as três hipóteses", async () => {
  const tela = await source("components/finance-workspace.tsx");

  assert.match(tela, /emptyDescription/);
  assert.match(tela, /Confira o vínculo desta obra/);
  assert.doesNotMatch(tela, /Não há contas para os filtros atuais ou a obra ainda precisa ser vinculada/);
});

test("o proxy de lançamentos repassa o filtro de centro de custo", async () => {
  const rota = await source("app/api/integrations/drap/lancamentos/route.ts");

  assert.match(rota, /const FILTERS = \[[^\]]*"centro_custo"/);
});
