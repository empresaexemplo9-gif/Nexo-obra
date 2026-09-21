import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const segredos = await vite.ssrLoadModule("/lib/server/segredos.ts");
test.after(() => vite.close());

const source = (path) => readFile(`${root}/${path}`, "utf8");

/** Comentário explica a decisão e cita o que NÃO se faz; a asserção é sobre o código. */
const semComentarios = (texto) => texto
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

// 32 bytes em base64 — a mesma forma que o painel de publicação recebe.
const CHAVE = Buffer.alloc(32, 7).toString("base64");
const OUTRA = Buffer.alloc(32, 9).toString("base64");

globalThis.__platformEnvOverride = { SECRETS_ENCRYPTION_KEY: CHAVE };

/**
 * A chave `drap_live_…` de cada empresa opera o financeiro dela. Ela fica no banco porque
 * chega uma vez só, numa resposta HTTP — e fica cifrada porque uma cópia de backup em
 * claro seria a chave do financeiro de todas as empresas atendidas.
 */

test("o que vai pro banco não parece com o segredo", async () => {
  const guardado = await segredos.cifrarSegredo("drap_live_abcdefghijklmnop");

  assert.equal(guardado.includes("drap_live"), false);
  assert.equal(await segredos.decifrarSegredo(guardado), "drap_live_abcdefghijklmnop");
});

test("cada cifra é diferente, mesmo do mesmo texto", async () => {
  // Vetor de inicialização sorteado por segredo. Sem isso, duas empresas com a mesma
  // chave teriam a mesma linha no banco — e quem lê o banco saberia disso.
  const a = await segredos.cifrarSegredo("igual");
  const b = await segredos.cifrarSegredo("igual");

  assert.notEqual(a, b);
  assert.equal(await segredos.decifrarSegredo(a), "igual");
  assert.equal(await segredos.decifrarSegredo(b), "igual");
});

test("segredo adulterado não vira credencial meio certa", async () => {
  const guardado = await segredos.cifrarSegredo("drap_live_original");
  const bytes = Buffer.from(guardado, "base64");
  bytes[bytes.length - 1] ^= 0xff; // mexe na etiqueta de autenticação

  assert.equal(await segredos.decifrarSegredo(bytes.toString("base64")), null);
});

test("cifra de outra chave não abre — devolve null, não exceção", async () => {
  // Quem chama precisa distinguir "esta empresa não tem credencial" de "o servidor caiu".
  const guardado = await segredos.cifrarSegredo("drap_live_original");

  globalThis.__platformEnvOverride = { SECRETS_ENCRYPTION_KEY: OUTRA };
  assert.equal(await segredos.decifrarSegredo(guardado), null);
  globalThis.__platformEnvOverride = { SECRETS_ENCRYPTION_KEY: CHAVE };
});

test("lixo no lugar do envelope não explode", async () => {
  for (const entrada of ["", "nao-e-base64!!", Buffer.from("curto").toString("base64")]) {
    assert.equal(await segredos.decifrarSegredo(entrada), null);
  }
});

test("sem chave configurada, não se grava em claro — recusa", async () => {
  globalThis.__platformEnvOverride = {};
  assert.equal(segredos.guardaDeSegredosConfigurada(), false);
  await assert.rejects(() => segredos.cifrarSegredo("x"), /secrets_unavailable|não está configurada/);

  // Chave de tamanho errado também é recusa: 16 bytes não é AES-256.
  globalThis.__platformEnvOverride = { SECRETS_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") };
  assert.equal(segredos.guardaDeSegredosConfigurada(), false);

  globalThis.__platformEnvOverride = { SECRETS_ENCRYPTION_KEY: CHAVE };
});

test("a chave das fotos e a das credenciais são separadas", async () => {
  // Compartilhar amarraria a rotação de uma à outra: girar a chave das fotos deixaria
  // todas as empresas sem integração no mesmo instante.
  const lib = semComentarios(await source("lib/server/segredos.ts"));
  assert.match(lib, /SECRETS_ENCRYPTION_KEY/);
  assert.doesNotMatch(lib, /MEDIA_ENCRYPTION_KEY/);
});

test("o ambiente continua vencendo o banco na resolução do token", async () => {
  // Quem já configurou à mão não muda de caminho por causa da tabela nova, e trocar o
  // segredo no painel continua sendo a saída de emergência.
  const adaptador = await source("lib/integrations/drap.ts");
  const funcao = adaptador.slice(adaptador.indexOf("async function apiTokenFor"), adaptador.indexOf("export function getDrapWebhookCandidates"));

  assert.ok(funcao.indexOf("doAmbiente") < funcao.indexOf("tokenGuardado"), "o banco não pode ser consultado antes do ambiente");
  assert.match(funcao, /await import\("@\/lib\/server\/drap-credenciais"\)/);
});

test("a rota de conexão confere a guarda antes de criar empresa na Drap", async () => {
  // Sem onde guardar a chave, provisionar criaria uma empresa lá que ninguém aqui opera —
  // e o documento único da Drap impediria criar de novo.
  const rota = await source("app/api/integrations/drap/provisionar/route.ts");
  const antesDaChamada = rota.slice(0, rota.indexOf("provisionarEmpresaNaDrap("));

  assert.match(antesDaChamada, /guardaDeSegredosConfigurada\(\)/);
  assert.match(antesDaChamada, /requireOrganizationContext\(request, \["owner", "admin"\]\)/);
});

test("vincular empresa existente exige código, não documento", async () => {
  const rota = await source("app/api/integrations/drap/provisionar/route.ts");
  const inicio = rota.indexOf('z.literal("vincular")');
  const ramo = rota.slice(inicio, rota.indexOf("}).strict()", inicio));

  assert.match(ramo, /codigo:/);
  assert.doesNotMatch(ramo, /documento/);
});

test("a chave nunca entra na auditoria nem na resposta", async () => {
  const rota = semComentarios(await source("app/api/integrations/drap/provisionar/route.ts"));
  const auditoria = rota.slice(rota.indexOf("auditStatement("), rota.indexOf("]);", rota.indexOf("auditStatement(")));
  assert.doesNotMatch(auditoria, /chave|token/);

  const resposta = rota.slice(rota.lastIndexOf("return Response.json("));
  assert.doesNotMatch(resposta, /chave|token/);
});

test("o retry reutiliza a mesma chave de idempotência", async () => {
  // Regra 5 do CLAUDE.md. Sortear uma chave por clique faria cada tentativa parecer um
  // pedido novo pra Drap — o oposto do que idempotência resolve.
  const rota = await source("app/api/integrations/drap/provisionar/route.ts");
  assert.match(rota, /const idempotencyKey = `hoikos:\$\{context\.organization\.id\}/);
  assert.doesNotMatch(rota, /idempotencyKey = crypto\.randomUUID/);
});

test("repetição sem chave não vira conexão que não opera", async () => {
  const rota = await source("app/api/integrations/drap/provisionar/route.ts");
  assert.match(rota, /chave_nao_devolvida/);
});
