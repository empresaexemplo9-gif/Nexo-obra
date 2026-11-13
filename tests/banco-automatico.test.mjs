import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { after, beforeEach } from "node:test";

import { createHarness, root } from "./helpers/api-harness.mjs";

// Atualização automática do banco: o agendamento aplica só o que acrescenta, nunca o que
// altera dado existente, nunca duas execuções ao mesmo tempo, e só com o segredo.

const h = await createHarness();
const cron = await h.load("/app/api/cron/banco/route.ts");
const migracoes = await h.load("/lib/server/migrations.ts");
const arquivos = (await readdir(`${root}/drizzle`)).filter((f) => f.endsWith(".sql")).sort();

class Banco {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql) {
    const sqlite = this.sqlite;
    return new (class {
      args = [];
      bind(...args) { this.args = args; return this; }
      execute() {
        const results = sqlite.prepare(sql).all(Object.fromEntries(this.args.map((v, i) => [i + 1, v])));
        return { success: true, results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } };
      }
      async all() { return this.execute(); }
      async run() { return this.execute(); }
      async first() { return this.execute().results[0] ?? null; }
    })();
  }
  async batch(statements) { return statements.map((s) => s.execute()); }
}

let banco;
/** Banco como em produção antes deste deploy: tudo até `ultima` aplicado e registrado. */
async function bancoAte(ultima) {
  banco = new Banco();
  banco.sqlite.exec("CREATE TABLE _platform_migrations (id text PRIMARY KEY NOT NULL, statements integer NOT NULL, skipped integer NOT NULL DEFAULT 0, applied_at integer NOT NULL)");
  for (const arquivo of arquivos.filter((f) => f.slice(0, 4) <= ultima)) {
    banco.sqlite.exec(await readFile(`${root}/drizzle/${arquivo}`, "utf8"));
    banco.sqlite.prepare("INSERT INTO _platform_migrations VALUES (?, 1, 0, 1)").run(arquivo.replace(/\.sql$/, ""));
  }
  h.runtime.DB = banco;
}
const chamar = (segredo = "segredo-de-teste", agente = "GitHub-Actions") => cron.GET(new Request("https://platform.test/api/cron/banco", { headers: { ...(segredo ? { authorization: `Bearer ${segredo}` } : {}), "user-agent": agente } }));

beforeEach(() => { h.reset(); h.runtime.CRON_SECRET = "segredo-de-teste"; });
after(() => h.close());

test("sem o segredo do agendamento, nada roda", async () => {
  await bancoAte("0028");
  assert.equal((await chamar(null)).status, 401);
  assert.equal((await chamar("errado")).status, 401);
  delete h.runtime.CRON_SECRET;
  assert.equal((await chamar()).status, 401, "sem CRON_SECRET configurado a rota fica fechada");
  assert.equal(banco.sqlite.prepare("SELECT COUNT(*) n FROM _platform_migrations").get().n, arquivos.filter((f) => f.slice(0, 4) <= "0028").length);
});

test("aplica as migrações aditivas pendentes, registra a execução e não repete", async () => {
  await bancoAte("0028");
  const resposta = await chamar();
  assert.equal(resposta.status, 200);
  const corpo = await resposta.json();
  const novas = arquivos.filter((f) => f.slice(0, 4) > "0028").map((f) => f.replace(/\.sql$/, ""));
  assert.deepEqual(corpo.applied.map((m) => m.id), novas);
  assert.deepEqual(corpo.pending, []);
  assert.equal(corpo.needsReview, null);
  for (const tabela of ["suppliers", "purchase_requests", "stock_movements", "supplier_price_lists"]) {
    assert.ok(banco.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(tabela), tabela);
  }
  const execucao = await migracoes.ultimaExecucao(banco);
  assert.equal(execucao.origin, "agendamento de hora em hora");
  assert.match(execucao.result, /^Aplicadas: 0029/);
  const segunda = await (await chamar("segredo-de-teste", "vercel-cron/1.0")).json();
  assert.deepEqual(segunda.applied, [], "a hora seguinte não faz nada");
  assert.equal((await migracoes.ultimaExecucao(banco)).origin, "cron da Vercel");
});

test("migração que altera dado existente espera revisão e segura as seguintes", async () => {
  await bancoAte("0028");
  banco.sqlite.prepare("DELETE FROM _platform_migrations WHERE id LIKE '0017%'").run();
  const corpo = await (await chamar()).json();
  assert.deepEqual(corpo.applied, [], "não aplica as posteriores à que precisa de revisão");
  assert.match(corpo.needsReview, /^0017_.* tem instrução que altera dado ou estrutura existente \(DROP INDEX/);
  assert.match((await migracoes.ultimaExecucao(banco)).result, /Aguardando revisão manual/);
  assert.equal(migracoes.migrations.filter((m) => m.id >= "0029").every((m) => migracoes.motivoParaRevisao(m) === null), true, "as de Compras e Estoque são aditivas");
});

test("duas execuções ao mesmo tempo: a segunda espera a próxima hora", async () => {
  await bancoAte("0028");
  await migracoes.ultimaExecucao(banco);
  banco.sqlite.prepare("INSERT OR REPLACE INTO _platform_migration_lock (id, token, locked_until) VALUES (1, 'outra', ?)").run(Date.now() + 60_000);
  const corpo = await (await chamar()).json();
  assert.deepEqual([corpo.ran, corpo.busy, corpo.applied.length], [false, true, 0]);
  assert.ok(corpo.pending.length > 0);
});
