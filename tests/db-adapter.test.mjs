import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createServer } from "vite";

// Adaptador de banco contra libSQL de verdade — sem o banco injetado dos outros testes.
// É o que sustenta a aposta de não reescrever os 52 arquivos que usam esta interface:
// se o contrato não fosse idêntico, ele quebraria aqui.

const root = fileURLToPath(new URL("..", import.meta.url));
const arquivo = `${root}/.sites-runtime/tmp/adaptador-teste.db`;

const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { getDatabase } = await vite.ssrLoadModule("/db/index.ts");
const { applyMigrations, migrationStatus } = await vite.ssrLoadModule("/lib/server/migrations.ts");

before(async () => {
  await rm(arquivo, { force: true });
  await rm(`${arquivo}-journal`, { force: true });
  // Nenhum DB injetado: o adaptador abre a conexão real.
  globalThis.__platformEnvOverride = { DATABASE_URL: `file:${arquivo}` };
});
after(async () => {
  await vite.close();
  delete globalThis.__platformEnvOverride;
  await rm(arquivo, { force: true });
});

test("o adaptador aplica as 15 migrações num banco libSQL real", async () => {
  const db = getDatabase();
  const antes = await migrationStatus(db);
  assert.equal(antes.pending.length, antes.total, "banco novo, tudo pendente");

  const resultado = await applyMigrations(db);
  assert.equal(resultado.pending.length, 0, "nada sobra pendente");
  assert.equal(resultado.applied.length, antes.total);

  const tabelas = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const nomes = tabelas.results.map((linha) => linha.name);
  for (const tabela of ["organizations", "members", "clients", "projects", "tasks", "worksheets", "usage_days", "goals"]) {
    assert.ok(nomes.includes(tabela), `${tabela} deveria existir`);
  }
});

test("marcadores posicionais, first, all e run funcionam como no contrato anterior", async () => {
  const db = getDatabase();
  const id = "11111111-1111-4111-8111-111111111111";
  const inserido = await db.prepare(
    "INSERT INTO organizations (id, name, slug, timezone, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
  ).bind(id, "Escritório Real", "escritorio-real", "America/Sao_Paulo", Date.now()).run();
  assert.equal(inserido.success, true);
  assert.equal(inserido.meta.changes, 1, "run informa quantas linhas mudaram");

  const linha = await db.prepare("SELECT id, name, timezone FROM organizations WHERE id = ?1").bind(id).first();
  assert.equal(linha.name, "Escritório Real");
  assert.equal(linha.timezone, "America/Sao_Paulo");

  const coluna = await db.prepare("SELECT name FROM organizations WHERE id = ?1").bind(id).first("name");
  assert.equal(coluna, "Escritório Real", "first(coluna) devolve o valor, não a linha");

  const vazio = await db.prepare("SELECT id FROM organizations WHERE id = ?1").bind("nao-existe").first();
  assert.equal(vazio, null, "sem resultado devolve null, não undefined");

  const todas = await db.prepare("SELECT id FROM organizations").all();
  assert.equal(todas.results.length, 1);
});

test("batch é transacional: uma instrução inválida desfaz o lote inteiro", async () => {
  const db = getDatabase();
  const antes = (await db.prepare("SELECT COUNT(*) AS n FROM clients").first()).n;

  await assert.rejects(db.batch([
    db.prepare("INSERT INTO clients (id, organization_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
      .bind("c1", "11111111-1111-4111-8111-111111111111", "Cliente Um", Date.now()),
    // Coluna inexistente: o lote inteiro precisa ser desfeito.
    db.prepare("INSERT INTO clients (id, coluna_que_nao_existe) VALUES (?1, ?2)").bind("c2", "x"),
  ]));

  const depois = (await db.prepare("SELECT COUNT(*) AS n FROM clients").first()).n;
  assert.equal(depois, antes, "nenhuma linha do lote permaneceu");
});

test("batch bem-sucedido grava tudo e devolve um resultado por instrução", async () => {
  const db = getDatabase();
  const org = "11111111-1111-4111-8111-111111111111";
  const resultados = await db.batch([
    db.prepare("INSERT INTO clients (id, organization_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
      .bind("ok1", org, "Cliente A", Date.now()),
    db.prepare("INSERT INTO clients (id, organization_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
      .bind("ok2", org, "Cliente B", Date.now()),
  ]);
  assert.equal(resultados.length, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM clients").first()).n, 2);
});

test("sem DATABASE_URL o adaptador diz o que falta, em vez de falhar de forma obscura", async () => {
  globalThis.__platformEnvOverride = {};
  try {
    await assert.rejects(getDatabase().prepare("SELECT 1").all(), /DATABASE_URL não está configurada/);
  } finally {
    globalThis.__platformEnvOverride = { DATABASE_URL: `file:${arquivo}` };
  }
});
