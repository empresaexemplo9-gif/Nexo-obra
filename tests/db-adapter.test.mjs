import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { createServer } from "vite";

// Adaptador de banco contra libSQL de verdade — sem o banco injetado dos outros testes.
// É o que sustenta a aposta de não reescrever os 52 arquivos que usam esta interface:
// se o contrato não fosse idêntico, ele quebraria aqui.

const root = fileURLToPath(new URL("..", import.meta.url));
// A real embedded libSQL database, without a filesystem lock surviving teardown on Windows.
const arquivo = ":memory:";

const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { getDatabase, databaseSettings, closeDatabase } = await vite.ssrLoadModule("/db/index.ts");
const { apiRoute } = await vite.ssrLoadModule("/lib/server/backend.ts");
const { applyMigrations, migrationStatus } = await vite.ssrLoadModule("/lib/server/migrations.ts");

before(async () => {
  // Nenhum DB injetado: o adaptador abre a conexão real.
  globalThis.__platformEnvOverride = { DATABASE_URL: `file:${arquivo}` };
});
after(async () => {
  closeDatabase();
  await vite.close();
  delete globalThis.__platformEnvOverride;
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

test("banco não configurado responde 503 com código próprio, e a mensagem chega à tela", async () => {
  // Este é o teste que faltava. O anterior só conferia que a exceção mencionava
  // DATABASE_URL — e passava enquanto, em produção, `apiRoute` engolia aquele `Error`
  // comum e devolvia "Não foi possível concluir a operação." O usuário via falha
  // genérica num problema de configuração, sem nenhuma pista. O que importa não é o
  // texto da exceção: é o que sai na resposta HTTP.
  globalThis.__platformEnvOverride = {};
  try {
    await assert.rejects(getDatabase().prepare("SELECT 1").all(), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "database_not_configured");
      return true;
    });

    const resposta = await apiRoute(async () => {
      await getDatabase().prepare("SELECT 1").all();
      return Response.json({ ok: true });
    });
    assert.equal(resposta.status, 503, "precisa atravessar apiRoute como 503");
    const corpo = await resposta.json();
    assert.equal(corpo.code, "database_not_configured");
    assert.match(corpo.error, /DATABASE_URL/, "a tela precisa dizer o que falta configurar");
    assert.doesNotMatch(corpo.error, /Não foi possível concluir a operação/);
  } finally {
    globalThis.__platformEnvOverride = { DATABASE_URL: `file:${arquivo}` };
  }
});

test("a URL é encontrada mesmo quando a integração prefixa o nome da variável", async () => {
  // Integração do marketplace pode prefixar tudo o que cria
  // (`vercel integration resource connect --prefix`). Nome fixo não basta.
  const casos = [
    [{ DATABASE_URL: "libsql://a.turso.io", DATABASE_AUTH_TOKEN: "t1" }, "libsql://a.turso.io", "t1"],
    [{ TURSO_DATABASE_URL: "libsql://b.turso.io", TURSO_AUTH_TOKEN: "t2" }, "libsql://b.turso.io", "t2"],
    [{ TURSO_CONNECTION_URL: "libsql://c.turso.io", TURSO_AUTH_TOKEN: "t3" }, "libsql://c.turso.io", "t3"],
    [{ NEON2_DATABASE_URL: "libsql://d.turso.io", NEON2_AUTH_TOKEN: "t4" }, "libsql://d.turso.io", "t4"],
    [{ MEU_PREFIXO_CONNECTION_URL: "libsql://e.turso.io", TURSO_AUTH_TOKEN: "t5" }, "libsql://e.turso.io", "t5"],
  ];
  for (const [env, url, token] of casos) {
    const resolvido = databaseSettings(env);
    assert.equal(resolvido?.url, url, JSON.stringify(env));
    assert.equal(resolvido?.authToken, token, JSON.stringify(env));
  }

  // Precedência: o nome explícito vence o prefixado.
  assert.equal(databaseSettings({ DATABASE_URL: "libsql://direto", OUTRO_DATABASE_URL: "libsql://prefixado" })?.url,
    "libsql://direto");
  // Uma variável com nome parecido mas valor que não é URL de banco não confunde.
  assert.equal(databaseSettings({ APP_DATABASE_URL: "sim", OUTRA: "libsql://x" }), null);
  assert.equal(databaseSettings({}), null);
});
