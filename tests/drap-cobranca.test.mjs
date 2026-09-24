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
  DRAP_LEGACY_COMPANY_ID: "empresa-1",
};

const fetchOriginal = globalThis.fetch;
test.after(() => { globalThis.fetch = fetchOriginal; });

function drapFalsa({ status = 201, body = {} } = {}) {
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url: new URL(url), init, corpo: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return chamadas;
}

const PEDIDO = {
  externalCustomerId: "22222222-2222-4222-8222-222222222222",
  description: "Medição 1 da obra",
  amountCents: 150000,
  dueDate: "2026-10-10",
};
const CHAVE = "11111111-1111-4111-8111-111111111111";

const COBRANCA = {
  cobranca: { id: "cob_1", status: "pendente", invoice_url: "https://www.asaas.com/i/abc", bank_slip_url: null },
  reaproveitada: false,
};

async function emitir() {
  const result = await drap.requestDrapApi("empresa-1", "/api/v1/cobrancas", { method: "POST", idempotencyKey: CHAVE, body: drap.corpoDaCobranca(PEDIDO) });
  return drap.lerCobrancaDaDrap(result.data);
}

test("fala o vocabulário da Drap e converte centavos em reais", async () => {
  const chamadas = drapFalsa({ body: COBRANCA });

  const charge = await emitir();

  const { corpo, url, init } = chamadas[0];
  assert.equal(url.pathname, "/api/v1/cobrancas");
  assert.equal(corpo.parceiro_id, PEDIDO.externalCustomerId);
  assert.equal(corpo.descricao, PEDIDO.description);
  // 150000 centavos = R$ 1.500,00. Mandar centavos aqui cobraria cem vezes
  // mais do cliente — o tipo de erro que não dá exceção nenhuma.
  assert.equal(corpo.valor, 1500);
  assert.equal(corpo.vencimento, "2026-10-10");
  assert.equal(corpo.forma, "UNDEFINED");

  assert.equal(init.headers.get("Idempotency-Key"), CHAVE);
  assert.equal(charge.id, "cob_1");
  assert.equal(charge.shareUrl, "https://www.asaas.com/i/abc");
});

test("o que é da H.OIKOS não vaza pro corpo da Drap", () => {
  // Centro de custo e política de lembrete não existem na cobrança da Drap.
  const corpo = drap.corpoDaCobranca(PEDIDO);
  for (const campo of ["cost_center_id", "centro_custo", "reminder_policy", "amount_cents", "customer_id"]) {
    assert.equal(campo in corpo, false, campo);
  }
});

test("a rota viva usa o contrato real, não o corpo inventado", async () => {
  // O PR #9 corrigiu o contrato numa função que a rota já não chamava; a rota seguia
  // mandando customer_id e amount_cents para a Drap.
  const rota = await (await import("node:fs/promises")).readFile(new URL("../app/api/integrations/drap/charges/route.ts", import.meta.url), "utf8");
  assert.match(rota, /corpoDaCobranca\(/);
  assert.match(rota, /lerCobrancaDaDrap\(/);
  assert.doesNotMatch(rota, /[^_]customer_id:|[^_]cost_center_id:|reminder_policy:|parceiro_id:|[^_]valor:/);
  // Reenvio com a mesma chave depois de falha tenta de novo em vez de devolver a falha como 200.
  assert.match(rota, /existing\.status !== "failed"/);
});

test("cobrança repetida pela Drap continua sendo cobrança válida", async () => {
  // 200 + reaproveitada: a Drap reconheceu a chave e devolveu a de antes.
  drapFalsa({ status: 200, body: { cobranca: { id: "cob_1", status: "pendente", invoice_url: "https://www.asaas.com/i/abc" }, reaproveitada: true } });

  const charge = await emitir();

  assert.equal(charge.id, "cob_1");
  assert.equal(charge.status, "pendente");
});

test("sem link de pagamento https, nenhum link — nunca um inventado", async () => {
  drapFalsa({ body: { cobranca: { id: "cob_2", status: "pendente", invoice_url: "http://inseguro.example/x" } } });

  const charge = await emitir();

  assert.equal(charge.shareUrl, null);
});

test("recusa da Drap sobe como erro, com o motivo legível", async () => {
  drapFalsa({ status: 422, body: { error: "parceiro-sem-documento" } });

  await assert.rejects(emitir, (erro) => {
    assert.ok(erro instanceof drap.DrapApiError);
    assert.equal(erro.status, 422);
    assert.equal(drap.motivoDaRecusaDrap(erro.detail), "parceiro-sem-documento");
    return true;
  });
});
