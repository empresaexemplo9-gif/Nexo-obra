import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(`${root}/${path}`, "utf8");

test("novas ativações usam política opcional congelada e preservam preço padrão", async () => {
  const activation = await source("lib/server/activation.ts");
  const ui = await source("components/platform-control.tsx");
  assert.match(activation, /product: "drap_embedded"/);
  assert.match(activation, /pricingMultiplierBps: pricing.multiplierBps/);
  assert.match(activation, /embeddedDrapMonthlyCents\(base: number\)[\s\S]*return checkedMonthlyCents\(base\)/);
  assert.match(ui, /Somente o superadministrador define um acréscimo opcional/);
  assert.doesNotMatch(ui, /\+\s*50%|acrescid[oa] de 50%/i);
});

test("contrato antigo de 150% existe somente como compatibilidade histórica", async () => {
  const activation = await source("lib/server/activation.ts");
  const sendBlock = activation.slice(activation.indexOf("export async function sendActivation"), activation.indexOf("const eventSchema"));
  assert.doesNotMatch(sendBlock, /15000|\* 3|1\.5/);
  assert.match(activation, /Mantido apenas para validar confirmações de ativações antigas/);
});

test("catálogo H.OIKOS reproduz os preços públicos DRAP sem preço vindo do navegador", async () => {
  const catalog = await source("lib/integrations/drap-catalog.ts");
  for (const [id, cents] of [
    ["dashboards-pro", 5900],
    ["integracoes", 2900],
    ["multi-usuario", 3900],
    ["contabilidade-basica", 6900],
    ["banco-conciliacao", 4900],
    ["fluxo-caixa-tesouraria", 6900],
    ["emissao-nota-fiscal", 7900],
    ["cobrancas", 5900],
    ["ia-assistente", 4900],
    ["assistente-whatsapp", 2900],
    ["pacote-essencial", 13900],
    ["pacote-fiscal", 15900],
    ["pacote-profissional", 32900],
    ["pacote-completo", 34900],
    ["retaguarda-mensal", 99000],
  ]) {
    const index = catalog.indexOf(`id: "${id}"`);
    assert.ok(index >= 0, `item ausente: ${id}`);
    assert.match(catalog.slice(index, index + 400), new RegExp(`monthlyCents: ${cents}`));
  }
  assert.match(catalog, /annualCents: 990000/);
});

test("catálogo é servido dentro da H.OIKOS e só manda criar conta quem ainda não tem", async () => {
  const route = await source("app/api/integrations/drap/catalog/route.ts");
  assert.match(route, /requireOrganizationContext/);
  assert.match(route, /requireModulePermission\(context, "finance", "view"\)/);
  assert.match(route, /pricing: "company_offer"/);
  // Enquanto a Drap não expõe rota de provisionamento, quem ainda não tem tenant é
  // levado ao cadastro oficial. Quem já tem opera dentro da H.OIKOS, sem sair.
  // O sinal precisa vir do estado do tenant: fixá-lo em `false` anunciava operação
  // embutida a quem ainda não tem conta, e fixá-lo em `true` mandaria para fora quem
  // já está ligado.
  assert.match(route, /requiresRedirect: !tenantProvisioned/);
  assert.doesNotMatch(route, /requiresRedirect: (true|false)/, "o sinal não pode ser constante");
  assert.match(route, /Cache-Control/);
});