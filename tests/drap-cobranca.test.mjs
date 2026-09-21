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
  externalCompanyId: "empresa-1",
  externalCustomerId: "22222222-2222-4222-8222-222222222222",
  costCenterId: "hoikos:obra-1",
  description: "Medição 1 da obra",
  amountCents: 150000,
  dueDate: "2026-10-10",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  reminders: { daysBefore: 3, onDueDate: true, overdueIntervalDays: 3 },
};

const COBRANCA = {
  cobranca: { id: "cob_1", status: "pendente", invoice_url: "https://www.asaas.com/i/abc", bank_slip_url: null },
  reaproveitada: false,
};

test("fala o vocabulário da Drap e converte centavos em reais", async () => {
  const chamadas = drapFalsa({ body: COBRANCA });

  const charge = await drap.createDrapCharge(PEDIDO);

  const { corpo, url, init } = chamadas[0];
  assert.equal(url.pathname, "/api/v1/cobrancas");
  assert.equal(corpo.parceiro_id, PEDIDO.externalCustomerId);
  assert.equal(corpo.descricao, PEDIDO.description);
  // 150000 centavos = R$ 1.500,00. Mandar centavos aqui cobraria cem vezes
  // mais do cliente — o tipo de erro que não dá exceção nenhuma.
  assert.equal(corpo.valor, 1500);
  assert.equal(corpo.vencimento, "2026-10-10");
  assert.equal(corpo.forma, "UNDEFINED");

  assert.equal(init.headers.get("Idempotency-Key"), PEDIDO.idempotencyKey);
  assert.equal(charge.id, "cob_1");
  assert.equal(charge.shareUrl, "https://www.asaas.com/i/abc");
});

test("o que é da H.OIKOS não vaza pro corpo da Drap", async () => {
  // Centro de custo e política de lembrete não existem na cobrança da Drap.
  // Mandar campo que o outro lado não conhece é como um contrato começa a
  // divergir sem ninguém perceber.
  const chamadas = drapFalsa({ body: COBRANCA });

  await drap.createDrapCharge(PEDIDO);

  const { corpo } = chamadas[0];
  assert.equal("cost_center_id" in corpo, false);
  assert.equal("centro_custo" in corpo, false);
  assert.equal("reminder_policy" in corpo, false);
  assert.equal("amount_cents" in corpo, false);
});

test("cobrança repetida pela Drap continua sendo cobrança válida", async () => {
  // 200 + reaproveitada: a Drap reconheceu a chave e devolveu a de antes.
  // Tratar isso como erro faria a H.OIKOS marcar como falha uma cobrança que
  // existe e está na mão do cliente.
  drapFalsa({ status: 200, body: { cobranca: { id: "cob_1", status: "pendente", invoice_url: "https://www.asaas.com/i/abc" }, reaproveitada: true } });

  const charge = await drap.createDrapCharge(PEDIDO);

  assert.equal(charge.id, "cob_1");
  assert.equal(charge.status, "pendente");
});

test("sem link de pagamento https, nenhum link — nunca um inventado", async () => {
  drapFalsa({ body: { cobranca: { id: "cob_2", status: "pendente" } } });

  const charge = await drap.createDrapCharge(PEDIDO);

  assert.equal(charge.shareUrl, null);
});

test("recusa da Drap sobe como erro, sem cobrança fantasma", async () => {
  drapFalsa({ status: 422, body: { error: "parceiro-sem-documento" } });

  await assert.rejects(() => drap.createDrapCharge(PEDIDO), /422/);
});

test("a capacidade de cobrança não depende mais de caminho configurado à mão", async () => {
  assert.equal(drap.isDrapChargesConfigured(), true);
});
