import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const drap = await vite.ssrLoadModule("/lib/integrations/drap.ts");
test.after(() => vite.close());

globalThis.__platformEnvOverride = {
  DRAP_API_URL: "https://empresa.drap.app.br",
  DRAP_API_TOKEN: "drap_live_credencial_de_teste",
};

const fetchOriginal = globalThis.fetch;
test.after(() => { globalThis.fetch = fetchOriginal; });

/** Drap de mentira roteada por caminho, pra simular o endpoint de resumo
 *  existindo ou não sem mexer na listagem. */
function drapFalsa(rotas) {
  const chamadas = [];
  globalThis.fetch = async (url) => {
    const alvo = new URL(url);
    chamadas.push(alvo);
    const rota = Object.entries(rotas).find(([caminho]) => alvo.pathname === caminho);
    if (!rota) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    const { status = 200, body = {} } = rota[1];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return chamadas;
}

const RESUMO = {
  realizado: { recebido: 5000, pago: 2000, saldo: 3000 },
  em_aberto: { a_receber: 1500, a_pagar: 400, saldo: 1100 },
  vencido: { a_receber: 500, a_pagar: 100 },
  proximos_30_dias: { a_receber: 700, a_pagar: 300 },
  total_lancamentos: 42,
  truncado: false,
  atualizado_em: "2026-09-17T00:00:00.000Z",
};

function lancamento(extra) {
  return { id: "1", data: "2026-09-01", descricao: "Medição", tipo: "receita", valor: 100, status: "pago", contraparte: null, centro_custo: null, ...extra };
}

test("usa o resumo oficial da Drap e mapeia os campos", async () => {
  const chamadas = drapFalsa({ "/api/v1/resumo": { body: RESUMO } });

  const resumo = await drap.fetchDrapFinancialSummary("empresa-1");

  assert.equal(chamadas.length, 1, "não deve paginar lançamentos quando o resumo responde");
  assert.equal(resumo.origem, "resumo");
  assert.equal(resumo.currentBalance, 3000);
  assert.equal(resumo.receivables, 1500);
  assert.equal(resumo.payables, 400);
  assert.equal(resumo.overdueReceivables, 500);
  assert.equal(resumo.updatedAt, "2026-09-17T00:00:00.000Z");
});

test("a projeção de 30 dias inclui o que já venceu e segue em aberto", async () => {
  drapFalsa({ "/api/v1/resumo": { body: RESUMO } });

  const resumo = await drap.fetchDrapFinancialSummary("empresa-1");

  // 3000 + (500 vencido + 700 a vencer) − (100 vencido + 300 a vencer)
  assert.equal(resumo.projected30d, 3800);
});

test("404 no resumo cai pro plano B e diz que caiu", async () => {
  const chamadas = drapFalsa({
    "/api/v1/resumo": { status: 404, body: { error: "not-found" } },
    "/api/v1/lancamentos": { body: { items: [lancamento({ valor: 250 })], total: 1 } },
  });

  const resumo = await drap.fetchDrapFinancialSummary("empresa-1");

  assert.equal(resumo.origem, "lancamentos");
  assert.equal(resumo.currentBalance, 250);
  assert.equal(chamadas.length, 2);
});

test("resposta sem `realizado` é tratada como endpoint ausente, não como zero", async () => {
  // Somar zeros aqui entregaria uma tela de saldo zerado que ninguém
  // desconfia. Melhor cair pro plano B, que ao menos soma dado real.
  drapFalsa({
    "/api/v1/resumo": { body: { mensagem: "em construção" } },
    "/api/v1/lancamentos": { body: { items: [lancamento({ valor: 80 })], total: 1 } },
  });

  const resumo = await drap.fetchDrapFinancialSummary("empresa-1");

  assert.equal(resumo.origem, "lancamentos");
  assert.equal(resumo.currentBalance, 80);
});

test("erro de credencial não vira plano B", async () => {
  // A listagem bateria na mesma parede. Insistir só troca um erro claro por
  // um número torto.
  drapFalsa({
    "/api/v1/resumo": { status: 401, body: { error: "invalid-api-key" } },
    "/api/v1/lancamentos": { body: { items: [lancamento({ valor: 999 })], total: 1 } },
  });

  await assert.rejects(() => drap.fetchDrapFinancialSummary("empresa-1"), /401/);
});

test("o plano B avisa quando a soma cobriu só parte da empresa", async () => {
  const pagina = Array.from({ length: 100 }, (_, i) => lancamento({ id: String(i), valor: 10 }));
  drapFalsa({
    "/api/v1/resumo": { status: 404, body: {} },
    "/api/v1/lancamentos": { body: { items: pagina, total: 5000 } },
  });

  const resumo = await drap.fetchDrapFinancialSummary("empresa-1");

  assert.equal(resumo.origem, "lancamentos");
  assert.equal(resumo.truncado, true);
});

test("truncado do resumo oficial chega até quem lê", async () => {
  drapFalsa({ "/api/v1/resumo": { body: { ...RESUMO, truncado: true } } });

  const resumo = await drap.fetchDrapFinancialSummary("empresa-1");

  assert.equal(resumo.truncado, true);
});
