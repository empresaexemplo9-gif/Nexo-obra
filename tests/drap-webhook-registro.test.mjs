import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const registro = await vite.ssrLoadModule("/lib/server/drap-webhook-registro.ts");
test.after(() => vite.close());

const source = (path) => readFile(`${root}/${path}`, "utf8");

/** Comentário explica a decisão e cita o que NÃO se faz; a asserção é sobre o código. */
const semComentarios = (texto) => texto
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const fetchOriginal = globalThis.fetch;
const ambienteOriginal = globalThis.__platformEnvOverride;

function ambiente(valores) {
  globalThis.__platformEnvOverride = { DRAP_API_URL: "https://empresa.drap.app.br", ...valores };
}

/** Encadeia respostas na ordem em que o código chama, e grava o que foi pedido. */
function fetchFalso(respostas) {
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    const proxima = respostas.shift();
    if (typeof proxima === "function") return proxima();
    return new Response(JSON.stringify(proxima.corpo ?? {}), { status: proxima.status ?? 200 });
  };
  return chamadas;
}

test.afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.__platformEnvOverride = ambienteOriginal;
});

/**
 * Registrar o webhook sozinha ao conectar é o que tira a plataforma de perguntar à Drap
 * "mudou alguma coisa?" em laço. O que este arquivo protege não é "funciona", é:
 *
 *   - para onde a Drap é mandada postar, e de onde esse endereço vem;
 *   - que uma falha aqui não vira sucesso na tela;
 *   - que tentar de novo não cria uma segunda assinatura.
 */

test("o endereço do receptor vem de configuração, nunca do pedido", async () => {
  // Derivar do cabeçalho `Host` deixaria quem conecta escolher para onde o financeiro da
  // empresa é enviado. Por isso a origem é ambiente, e só.
  const rota = semComentarios(await source("lib/server/drap-webhook-registro.ts"));
  assert.equal(/req(uest)?\.headers/.test(rota), false);
  assert.equal(rota.includes("host"), false);
});

test("usa o domínio de produção da Vercel quando não há endereço explícito", () => {
  ambiente({ VERCEL_PROJECT_PRODUCTION_URL: "hoikos.com.br" });
  assert.equal(registro.urlDoReceptor(), "https://hoikos.com.br/api/integrations/drap/webhook");
});

test("o endereço explícito vence o da Vercel", () => {
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br", VERCEL_PROJECT_PRODUCTION_URL: "hoikos.vercel.app" });
  assert.equal(registro.urlDoReceptor(), "https://app.hoikos.com.br/api/integrations/drap/webhook");
});

test("endereço sem HTTPS não vira destino de webhook", () => {
  // A Drap recusa destino que não seja HTTPS. Falhar aqui, com a configuração à vista, diz
  // o que corrigir; deixar passar renderia um 400 de lá sem explicação.
  ambiente({ HOIKOS_PUBLIC_URL: "http://app.hoikos.com.br" });
  assert.equal(registro.urlDoReceptor(), null);
});

test("sem endereço configurado, não registra e diz por quê", async () => {
  ambiente({});
  const chamadas = fetchFalso([]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "url-publica-ausente");
  assert.equal(resultado.motivo.includes("HOIKOS_PUBLIC_URL"), true);
  assert.equal(chamadas.length, 0, "não deve falar com a Drap sem saber o destino");
});

test("caminho feliz: consulta, cria e devolve o segredo", async () => {
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br" });
  const chamadas = fetchFalso([
    { corpo: { items: [] } },
    { status: 201, corpo: { webhook: { id: "w1" }, secret: "segredo-da-drap" } },
  ]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, true);
  assert.equal(resultado.segredo, "segredo-da-drap");
  assert.equal(resultado.url, "https://app.hoikos.com.br/api/integrations/drap/webhook");
  assert.equal(chamadas[0].method, "GET");
  assert.equal(chamadas[1].method, "POST");
  assert.equal(chamadas[1].body.url, "https://app.hoikos.com.br/api/integrations/drap/webhook");
});

test("consulta antes de criar, porque criar não é idempotente na Drap", async () => {
  // `POST /api/v1/webhooks` não aceita Idempotency-Key. Sem a consulta, uma segunda
  // tentativa criaria a segunda assinatura para a mesma URL e cada evento chegaria em
  // dobro — até alguém notar.
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br" });
  const chamadas = fetchFalso([
    { corpo: { items: [{ id: "w1", url: "https://app.hoikos.com.br/api/integrations/drap/webhook" }] } },
  ]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "assinatura-duplicada");
  assert.equal(chamadas.length, 1, "não deve criar a segunda assinatura");
});

test("assinatura de outra URL não impede registrar a nossa", async () => {
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br" });
  fetchFalso([
    { corpo: { items: [{ id: "w1", url: "https://outro-sistema.com.br/hook" }] } },
    { status: 201, corpo: { secret: "s" } },
  ]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, true);
});

test("403 na consulta é reportado como falta de escopo", async () => {
  // Acontece com empresa conectada antes de a plataforma passar a pedir `webhooks:*`.
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br" });
  fetchFalso([{ status: 403, corpo: { error: "insufficient-scope", detail: "Escopo webhooks:read ausente." } }]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "sem-escopo-de-webhook");
});

test("recusa da Drap não vira sucesso, e o motivo dela sobe", async () => {
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br" });
  fetchFalso([
    { corpo: { items: [] } },
    { status: 403, corpo: { error: "module-required", detail: "Módulo Integrações inativo." } },
  ]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "module-required");
  assert.equal(resultado.motivo, "Módulo Integrações inativo.");
});

test("criação sem segredo na resposta é falha, não sucesso", async () => {
  // Sem segredo não há como conferir assinatura nenhuma: toda entrega seria recusada com
  // 401. Gravar isso como conectado esconderia um webhook que nunca funciona.
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br" });
  fetchFalso([{ corpo: { items: [] } }, { status: 201, corpo: { webhook: { id: "w1" } } }]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "resposta-sem-segredo");
});

test("Drap fora do ar não lança: vira estado, não exceção", async () => {
  ambiente({ HOIKOS_PUBLIC_URL: "https://app.hoikos.com.br" });
  fetchFalso([() => { throw new Error("ECONNRESET"); }]);

  const resultado = await registro.registrarWebhookNaDrap("drap_live_x");

  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, "drap-indisponivel");
});

test("assina só os eventos que a plataforma trata", async () => {
  // `processDrapEvent` age sobre lancamento.* e cobranca.*, e arquiva o resto como
  // ignored. Assinar o catálogo inteiro faria a Drap entregar — e repetir com backoff no
  // erro — eventos que este lado joga fora.
  const tratados = semComentarios(await source("lib/server/drap-events.ts"));
  assert.equal(tratados.includes('startsWith("lancamento.")'), true);
  assert.equal(tratados.includes('startsWith("cobranca.")'), true);

  for (const evento of registro.EVENTOS_ASSINADOS) {
    assert.equal(/^(lancamento|cobranca)\./.test(evento), true, `${evento} não é tratado por processDrapEvent`);
  }
  assert.equal(registro.EVENTOS_ASSINADOS.includes("lancamento.created"), true);
  assert.equal(registro.EVENTOS_ASSINADOS.includes("cobranca.paga"), true);
});

test("a chave da empresa pede os escopos de webhook explicitamente", async () => {
  // São recursos sensíveis na Drap: não vêm no escopo padrão do parceiro. Pedir aqui, no
  // código que os usa, em vez de alargar o padrão de lá para todo parceiro futuro.
  assert.equal(registro.ESCOPOS_DA_PLATAFORMA.includes("webhooks:write"), true);
  assert.equal(registro.ESCOPOS_DA_PLATAFORMA.includes("webhooks:read"), true);
  // Remover assinatura é do dono da empresa, no painel da Drap.
  assert.equal(registro.ESCOPOS_DA_PLATAFORMA.includes("webhooks:delete"), false);

  const parceiro = semComentarios(await source("lib/integrations/drap-partner.ts"));
  assert.equal(parceiro.includes("ESCOPOS_DA_PLATAFORMA"), true);
});

test("o segredo do webhook não chega ao navegador nem à auditoria", async () => {
  const conectar = semComentarios(await source("lib/server/drap-webhook-conectar.ts"));
  const auditoria = conectar.slice(conectar.indexOf("auditStatement("), conectar.indexOf("return { ok: true"));
  assert.equal(auditoria.includes("segredo"), false);
  assert.equal(auditoria.includes("secret"), false);

  const rota = semComentarios(await source("app/api/integrations/drap/provisionar/route.ts"));
  const resposta = rota.slice(rota.indexOf("return Response.json(\n      {\n        connection:"));
  assert.equal(resposta.includes("segredo"), false);
  assert.equal(resposta.includes("secret"), false);
});

test("o registro acontece depois de a conexão existir", async () => {
  // Registrar antes deixaria, numa falha de gravação, uma assinatura viva na Drap
  // apontando para cá sem nada aqui capaz de reconhecê-la.
  const rota = await source("app/api/integrations/drap/provisionar/route.ts");
  assert.equal(rota.indexOf("instrucoesParaGuardarCredenciais({") < rota.indexOf("conectarWebhook("), true);
});

test("falha no webhook não derruba a conexão", async () => {
  // A conexão vale sem webhook: perde-se o aviso automático, não o acesso. Lançar aqui
  // mandaria o usuário desfazer o que acabou de dar certo.
  const rota = semComentarios(await source("app/api/integrations/drap/provisionar/route.ts"));
  const depois = rota.slice(rota.indexOf("conectarWebhook("));
  assert.equal(depois.includes("throw"), false);
  assert.equal(depois.includes("registrado: false"), true);
});

test("a tela não diz 'conectada' quando o webhook não registrou", async () => {
  const tela = semComentarios(await source("components/drap-conectar.tsx"));
  assert.equal(tela.includes("toast.warning"), true);
  assert.equal(tela.includes("resposta.webhook.motivo"), true);
});

test("a nova tentativa não aceita empresa vinda do navegador", async () => {
  // Aceitar um externalCompanyId do corpo deixaria um administrador registrar webhook
  // para a empresa de outra organização.
  const rota = semComentarios(await source("app/api/integrations/drap/webhook/registrar/route.ts"));
  assert.equal(rota.includes("jsonBody"), false);
  assert.equal(rota.includes("requireOrganizationContext(request, [\"owner\", \"admin\"])"), true);
  assert.equal(rota.includes("organization_id = ?1"), true);
});

test("a nova tentativa não duplica assinatura quando já há segredo", async () => {
  const rota = semComentarios(await source("app/api/integrations/drap/webhook/registrar/route.ts"));
  const guarda = rota.slice(0, rota.indexOf("conectarWebhook("));
  assert.equal(guarda.includes("webhook_secret_encrypted"), true);
  assert.equal(guarda.includes("registrado: true"), true);
});

test("o receptor confere os segredos guardados no banco, não só os do ambiente", async () => {
  // Sem isto o registro automático não serviria de nada: a assinatura chegaria correta e
  // o receptor a recusaria com 401, por só conhecer os segredos colados à mão.
  const receptor = semComentarios(await source("app/api/integrations/drap/webhook/route.ts"));
  assert.equal(receptor.includes("getDrapWebhookCandidatesAsync"), true);

  const cliente = semComentarios(await source("lib/integrations/drap.ts"));
  const assincrono = cliente.slice(cliente.indexOf("export async function getDrapWebhookCandidatesAsync"));
  assert.equal(assincrono.includes("segredosDeWebhookGuardados"), true);
});
