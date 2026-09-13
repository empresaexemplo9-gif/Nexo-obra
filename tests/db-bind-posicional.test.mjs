// O defeito que este arquivo existe para impedir:
//
// `bind()` convertia os valores posicionais num objeto `{1: v, 2: v}`. O cliente NATIVO
// do libSQL aceita isso, então toda a suíte passava — os testes rodam sobre `file:`.
// Em produção o cliente é `@libsql/client/web`, que empacota objeto como `namedArgs`
// ([{name: "1", value}]), e o servidor recusa: `?1` é parâmetro numerado, não nomeado.
// Resultado: "Input error: named parameter 1 at position 1 has no binding" em toda
// consulta com parâmetro — ou seja, o produto inteiro fora do ar, com a suíte verde.
//
// A garantia aqui é do FORMATO entregue ao driver, que é o que difere entre os clientes.
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const arquivo = `${root}.sites-runtime/teste-bind.db`;
const runtime = { DATABASE_URL: `file:${arquivo}` };
globalThis.__platformEnvOverride = runtime;

const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { getDatabase } = await vite.ssrLoadModule("/db/index.ts");
after(async () => { await vite.close(); await rm(arquivo, { force: true }); });

test("a consulta com parâmetros atravessa o adaptador de ponta a ponta", async () => {
  const db = getDatabase();
  await db.prepare("CREATE TABLE IF NOT EXISTS bind_teste (a TEXT, b TEXT)").run();
  await db.prepare("INSERT INTO bind_teste VALUES (?1, ?2)").bind("um", "dois").run();
  const linha = await db.prepare("SELECT a, b FROM bind_teste WHERE a = ?1 AND b = ?2").bind("um", "dois").first();
  assert.deepEqual(linha, { a: "um", b: "dois" });
});

test("o formato dos argumentos é array — objeto vira parâmetro nomeado e quebra no cliente web", async () => {
  // Reproduz a diferença entre os clientes sem precisar de um banco remoto: o array é a
  // única forma que os dois aceitam para marcadores `?1`.
  const cliente = createClient({ url: `file:${arquivo}` });
  await cliente.execute("CREATE TABLE IF NOT EXISTS forma (a TEXT)");
  await cliente.execute({ sql: "INSERT INTO forma VALUES (?1)", args: ["v"] });

  const comArray = await cliente.execute({ sql: "SELECT a FROM forma WHERE a = ?1", args: ["v"] });
  assert.equal(comArray.rows.length, 1, "array posicional é aceito");

  // E o adaptador precisa produzir exatamente essa forma.
  const db = getDatabase();
  const preparada = db.prepare("SELECT a FROM forma WHERE a = ?1").bind("v");
  assert.ok(Array.isArray(preparada.__args), `__args deveria ser array, veio ${JSON.stringify(preparada.__args)}`);
  assert.deepEqual(preparada.__args, ["v"]);
});

test("batch também leva array posicional", async () => {
  const db = getDatabase();
  await db.prepare("CREATE TABLE IF NOT EXISTS lote (a TEXT)").run();
  const declaracoes = [
    db.prepare("INSERT INTO lote VALUES (?1)").bind("a"),
    db.prepare("INSERT INTO lote VALUES (?1)").bind("b"),
  ];
  for (const d of declaracoes) assert.ok(Array.isArray(d.__args), "cada declaração do lote leva array");
  await db.batch(declaracoes);
  const total = await db.prepare("SELECT COUNT(*) AS n FROM lote").first("n");
  assert.equal(Number(total), 2);
});
