#!/usr/bin/env node
/**
 * Aplica as migrações de `drizzle/` no D1 LOCAL do Miniflare.
 *
 * Apenas desenvolvimento. Em produção as migrações são aplicadas pelo plano de
 * controle, a partir de `dist/.openai/drizzle` (ver `build/sites-vite-plugin.ts`).
 *
 * Existe porque `npm run dev` cria o banco local vazio: sem isso a primeira
 * tela cai no estado "banco indisponível". Usa `node:sqlite`, já embutido no
 * Node 22, em vez de uma dependência nova.
 *
 * Uso: npm run db:migrate:local
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const D1_STATE_DIR = path.join(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

async function findLocalDatabase() {
  let entries;
  try {
    entries = await readdir(D1_STATE_DIR);
  } catch {
    return null;
  }

  // O Miniflare nomeia o arquivo por hash do binding; `metadata.sqlite` é dele.
  const file = entries.find((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  return file ? path.join(D1_STATE_DIR, file) : null;
}

async function main() {
  const databasePath = await findLocalDatabase();
  if (!databasePath) {
    console.error(
      "Banco D1 local não encontrado. Rode `npm run dev` uma vez para o Miniflare criá-lo, depois repita este comando.",
    );
    process.exitCode = 1;
    return;
  }

  const sqlite = new DatabaseSync(databasePath);

  // Controle de aplicadas, para o comando ser repetível sem erro.
  sqlite.exec(`
    create table if not exists __nexo_migrations (
      name text primary key,
      applied_at text not null default CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(
    sqlite.prepare("select name from __nexo_migrations").all().map((row) => row.name),
  );

  const directory = path.join(root, "drizzle");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const pending = files.filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log(`Nada a aplicar. ${files.length} migrações já estão no banco local.`);
    sqlite.close();
    return;
  }

  for (const file of pending) {
    const contents = await readFile(path.join(directory, file), "utf8");
    sqlite.exec("begin");
    try {
      for (const statement of contents.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) sqlite.exec(trimmed);
      }
      sqlite.prepare("insert into __nexo_migrations (name) values (?)").run(file);
      sqlite.exec("commit");
      console.log(`aplicada: ${file}`);
    } catch (error) {
      sqlite.exec("rollback");
      console.error(`falhou: ${file}`);
      throw error;
    }
  }

  sqlite.close();
  console.log(`Pronto. ${pending.length} migração(ões) aplicada(s) em ${databasePath}`);
}

await main();
