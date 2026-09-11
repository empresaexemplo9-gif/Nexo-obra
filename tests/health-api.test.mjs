import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";
import { createServer } from "vite";

// Diagnóstico da instalação. Esta rota existe porque faltou exatamente ela: com a
// configuração incompleta em produção, a única coisa visível era uma mensagem genérica de
// login, e sem logs de runtime não havia como distinguir "faltou a variável" de "a
// variável está errada" de "falta migrar". Aqui se verifica que ela acerta cada caso —
// e, tão importante quanto, que não vaza nada.

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {};
globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const migrations = await Promise.all((await readdir(`${root}/drizzle`)).filter((file) => file.endsWith(".sql")).sort().map((file) => readFile(`${root}/drizzle/${file}`, "utf8")));
const health = await vite.ssrLoadModule("/app/api/health/route.ts");

class D1Local {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql) {
    const sqlite = this.sqlite;
    return new (class {
      args = [];
      bind(...args) { this.args = args; return this; }
      execute() {
        const statement = sqlite.prepare(sql);
        const results = statement.all(Object.fromEntries(this.args.map((value, i) => [i + 1, value])));
        return { success: true, results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } };
      }
      async all() { return this.execute(); }
      async run() { return this.execute(); }
      async first() { return this.execute().results[0] ?? null; }
    })();
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const r = statements.map((s) => s.execute()); this.sqlite.exec("COMMIT"); return r; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const HASH = "pbkdf2-sha256:100000:kLxHh1O29gxm6zLhdJ0vNw:u0woQ0SP20-MVm6FMl092JBVTXFIrtGBES2Vj7mqVD8";
const CHAVE = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

let db;
function completo(extra = {}) {
  return {
    DB: db, DATABASE_URL: "libsql://exemplo.turso.io",
    SESSION_SECRET: SEGREDO, SUPERADMIN_SESSION_SECRET: SEGREDO,
    SUPERADMIN_EMAIL: "admin@plataforma.test", SUPERADMIN_PASSWORD_HASH: HASH,
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_teste", MEDIA_ENCRYPTION_KEY: CHAVE,
    ...extra,
  };
}
const ler = async () => (await health.GET()).json();

beforeEach(() => {
  db?.sqlite.close(); db = new D1Local();
  for (const key of Object.keys(runtime)) delete runtime[key];
  Object.assign(runtime, completo());
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });

test("instalação completa e migrada responde pronto", async () => {
  for (const migration of migrations) db.sqlite.exec(migration);
  // Marca todas como aplicadas, como faria o botão do painel.
  db.sqlite.exec("CREATE TABLE IF NOT EXISTS _platform_migrations (id text PRIMARY KEY NOT NULL, statements integer NOT NULL, skipped integer NOT NULL DEFAULT 0, applied_at integer NOT NULL)");
  const nomes = (await readdir(`${root}/drizzle`)).filter((f) => f.endsWith(".sql")).sort();
  for (const nome of nomes) {
    db.sqlite.prepare("INSERT INTO _platform_migrations(id,statements,skipped,applied_at) VALUES (?,1,0,0)").run(nome.replace(/\.sql$/, ""));
  }

  const corpo = await ler();
  assert.equal(corpo.pronto, true, JSON.stringify(corpo));
  assert.equal(corpo.banco, "ok");
  assert.equal(corpo.sessao, "ok");
  assert.equal(corpo.superadmin, "ok");
  assert.equal(corpo.armazenamento, "ok");
  assert.equal(corpo.migracoes.pendentes, 0);
});

test("banco com migração pendente é falta_migrar, não erro genérico", async () => {
  const corpo = await ler();
  assert.equal(corpo.banco, "falta_migrar");
  assert.equal(corpo.pronto, false);
  assert.ok(corpo.migracoes.pendentes > 0, "diz quantas faltam");
});

test("cada variável ausente aparece como nao_configurado na sua área", async () => {
  const casos = [
    [{ DATABASE_URL: undefined, DB: undefined }, "banco"],
    [{ SESSION_SECRET: undefined, SUPERADMIN_SESSION_SECRET: undefined }, "sessao"],
    [{ SUPERADMIN_PASSWORD_HASH: undefined }, "superadmin"],
    [{ BLOB_READ_WRITE_TOKEN: undefined }, "armazenamento"],
    [{ MEDIA_ENCRYPTION_KEY: undefined }, "armazenamento"],
  ];
  for (const [remocao, area] of casos) {
    Object.assign(runtime, completo(remocao));
    const corpo = await ler();
    assert.equal(corpo[area], "nao_configurado", `${area} com ${JSON.stringify(remocao)}: ${JSON.stringify(corpo)}`);
  }
});

test("valor presente mas inválido é configuracao_invalida, e não passa por ausente", async () => {
  const casos = [
    // Hash mutilado pela expansão de `$` — o caso real que fez o login recusar a senha certa.
    [{ SUPERADMIN_PASSWORD_HASH: "pbkdf2-sha256$100000$$" }, "superadmin"],
    [{ SUPERADMIN_PASSWORD_HASH: "senha-em-texto-puro" }, "superadmin"],
    [{ SESSION_SECRET: "curto", SUPERADMIN_SESSION_SECRET: "curto" }, "sessao"],
    [{ MEDIA_ENCRYPTION_KEY: "bm9wZQ==" }, "armazenamento"],
  ];
  for (const [valor, area] of casos) {
    Object.assign(runtime, completo(valor));
    const corpo = await ler();
    assert.equal(corpo[area], "configuracao_invalida", `${area} com ${JSON.stringify(valor)}`);
  }
});

test("banco que recusa a conexão é inalcancavel", async () => {
  Object.assign(runtime, completo({
    DB: { prepare() { throw new Error("Hrana: UNAUTHORIZED"); }, async batch() { throw new Error("x"); } },
  }));
  const corpo = await ler();
  assert.equal(corpo.banco, "inalcancavel");
  assert.equal(corpo.pronto, false);
});

test("a resposta não vaza segredo, endereço, e-mail nem nome de variável", async () => {
  for (const migration of migrations) db.sqlite.exec(migration);
  const texto = JSON.stringify(await ler());
  for (const sigiloso of [SEGREDO, HASH, CHAVE, "vercel_blob_rw_teste", "admin@plataforma.test", "exemplo.turso.io", "libsql://"]) {
    assert.ok(!texto.includes(sigiloso), `vazou ${sigiloso} em ${texto}`);
  }
  for (const nome of ["DATABASE_URL", "SESSION_SECRET", "SUPERADMIN", "BLOB_READ_WRITE_TOKEN", "MEDIA_ENCRYPTION_KEY"]) {
    assert.ok(!texto.includes(nome), `vazou o nome ${nome}`);
  }
  // O que ela devolve é uma palavra por área, e a versão no ar.
  assert.deepEqual(Object.keys(await ler()).sort(),
    ["armazenamento", "banco", "compiladoEm", "migracoes", "pronto", "sessao", "superadmin", "versao"]);
});

test("a rota não é cacheada: um diagnóstico velho engana mais do que ajuda", async () => {
  assert.equal((await health.GET()).headers.get("cache-control"), "no-store");
});
