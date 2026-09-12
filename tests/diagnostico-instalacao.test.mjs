// O diagnóstico precisa dizer o QUE conferir, não só que algo está errado.
// Antes, "hash ilegível, gere com ':'" era um beco sem saída para quem já tinha gerado
// com ':': a tela mandava repetir o que a pessoa acabou de fazer.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const health = await vite.ssrLoadModule("/app/api/health/route.ts");
const { apiRoute } = await vite.ssrLoadModule("/lib/server/backend.ts");
after(() => vite.close());

const limpa = () => { for (const chave of Object.keys(runtime)) delete runtime[chave]; };
const saude = async () => (await health.GET()).json();

const HASH_BOM = "pbkdf2-sha256:100000:c2FsdGVzYWx0c2FsdA:ZGlnZXN0b2RpZ2VzdG9kaWdlc3RvZGln";

test("o hash mutilado pela expansão de $ é descrito pela forma, não por um palpite", async () => {
  limpa();
  Object.assign(runtime, {
    SUPERADMIN_EMAIL: "a@b.test",
    SUPERADMIN_SESSION_SECRET: "x".repeat(40),
    // É assim que o hash chega quando o painel expande "$salt" e "$digest" para vazio.
    SUPERADMIN_PASSWORD_HASH: "pbkdf2-sha256$100000$$",
  });
  const corpo = await saude();
  assert.equal(corpo.superadmin, "configuracao_invalida");
  assert.match(corpo.detalhes.superadmin, /caracteres em \d+ parte\(s\) separadas por "\$"/);
  assert.match(corpo.detalhes.superadmin, /expandido pelo painel/);
});

test("um hash com ':' e formato errado não manda trocar para ':' de novo", async () => {
  limpa();
  Object.assign(runtime, {
    SUPERADMIN_EMAIL: "a@b.test",
    SUPERADMIN_SESSION_SECRET: "x".repeat(40),
    SUPERADMIN_PASSWORD_HASH: "pbkdf2-sha256:1000:sal:digest",
  });
  const corpo = await saude();
  assert.equal(corpo.superadmin, "configuracao_invalida");
  assert.match(corpo.detalhes.superadmin, /iterações deveria ser 100000/);
  assert.doesNotMatch(corpo.detalhes.superadmin, /expandido pelo painel/,
    "quem já usou ':' não pode receber a instrução de usar ':'");
});

test("o detalhe descreve a forma e nunca devolve o hash", async () => {
  limpa();
  const segredo = "pbkdf2-sha256:100000:SALGRANDESECRETO:DIGESTOSUPERSECRETO";
  Object.assign(runtime, { SUPERADMIN_EMAIL: "a@b.test", SUPERADMIN_SESSION_SECRET: "x".repeat(40), SUPERADMIN_PASSWORD_HASH: segredo + "!" });
  const corpo = await saude();
  const texto = JSON.stringify(corpo);
  assert.equal(texto.includes("SALGRANDESECRETO"), false, "o sal não pode vazar no health");
  assert.equal(texto.includes("DIGESTOSUPERSECRETO"), false, "o digest não pode vazar no health");
});

test("o hash válido não gera detalhe nenhum", async () => {
  limpa();
  Object.assign(runtime, { SUPERADMIN_EMAIL: "a@b.test", SUPERADMIN_SESSION_SECRET: "x".repeat(40), SUPERADMIN_PASSWORD_HASH: HASH_BOM });
  const corpo = await saude();
  assert.equal(corpo.superadmin, "ok");
  assert.equal(corpo.detalhes?.superadmin, undefined);
});

test("o armazenamento diz qual das duas variáveis falta", async () => {
  limpa();
  Object.assign(runtime, { BLOB_READ_WRITE_TOKEN: "token-qualquer" });
  const corpo = await saude();
  assert.equal(corpo.armazenamento, "nao_configurado");
  assert.match(corpo.detalhes.armazenamento, /MEDIA_ENCRYPTION_KEY/);
  assert.doesNotMatch(corpo.detalhes.armazenamento, /BLOB_READ_WRITE_TOKEN/, "essa está configurada");
});

test("a falha 500 carrega o código do driver, não só o nome da classe", async () => {
  class LibsqlError extends Error { constructor(m, code) { super(m); this.code = code; } }
  const resposta = await apiRoute(async () => { throw new LibsqlError("SQLITE_UNKNOWN: deu ruim", "SQLITE_UNKNOWN"); });
  assert.equal(resposta.status, 500);
  const corpo = await resposta.json();
  assert.equal(corpo.falha, "LibsqlError: SQLITE_UNKNOWN");
});

test("a mensagem do driver nunca entra no lugar do código", async () => {
  class LibsqlError extends Error { constructor(m, code) { super(m); this.code = code; } }
  // Um "code" que não tem a forma de token fechado é descartado: pode ser texto livre
  // com endereço ou credencial dentro.
  const resposta = await apiRoute(async () => { throw new LibsqlError("falhou", "libsql://banco-org.turso.io?authToken=segredo"); });
  const corpo = await resposta.json();
  assert.equal(corpo.falha, "LibsqlError");
});

test("uma causa aninhada ainda é classificada como banco desatualizado", async () => {
  const raiz = new Error("SQLITE_UNKNOWN: SQLite error: no such table: clients");
  const resposta = await apiRoute(async () => { throw new Error("falha ao consultar", { cause: raiz }); });
  assert.equal(resposta.status, 503);
  assert.equal((await resposta.json()).code, "database_not_migrated");
});

test("SQLITE_UNKNOWN carrega o motivo do SQLite, que é o que resolve", async () => {
  class LibsqlError extends Error { constructor(m, code) { super(m); this.code = code; } }
  const resposta = await apiRoute(async () => {
    throw new LibsqlError("SQLITE_UNKNOWN: SQLite error: UNIQUE constraint failed: members.email", "SQLITE_UNKNOWN");
  });
  const corpo = await resposta.json();
  assert.equal(corpo.falha, "LibsqlError: SQLITE_UNKNOWN — UNIQUE constraint failed: members.email");
});

test("motivo desconhecido do SQLite não é repassado", async () => {
  class LibsqlError extends Error { constructor(m, code) { super(m); this.code = code; } }
  const resposta = await apiRoute(async () => {
    throw new LibsqlError("SQLITE_UNKNOWN: SQLite error: algo inesperado com token=abc123", "SQLITE_UNKNOWN");
  });
  const corpo = await resposta.json();
  assert.equal(corpo.falha, "LibsqlError: SQLITE_UNKNOWN", "só motivos de uma lista conhecida atravessam");
});

test("o motivo é higienizado: e-mail e URL não atravessam", async () => {
  class LibsqlError extends Error { constructor(m, code) { super(m); this.code = code; } }
  const resposta = await apiRoute(async () => {
    throw new LibsqlError("SQLITE_UNKNOWN: SQLite error: UNIQUE constraint failed: pessoa@empresa.com libsql://banco.turso.io", "SQLITE_UNKNOWN");
  });
  const corpo = await resposta.json();
  assert.equal(corpo.falha.includes("@"), false, "arroba de e-mail não passa");
  assert.equal(corpo.falha.includes("/"), false, "barra de URL não passa");
});
