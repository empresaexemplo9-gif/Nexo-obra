import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Ambiente de teste para a camada de dados.
 *
 * Usa `node:sqlite` (já embutido no Node 22) com o driver `sqlite-proxy` do
 * Drizzle, em vez de trazer um driver novo como dependência. O ganho é que o
 * teste executa o SQL REAL gerado por `lib/data/*`: se um `where` esquecer
 * `organization_id`, a consulta devolve a linha da outra empresa e o teste
 * falha. Um teste que apenas inspecionasse o texto do arquivo não pegaria isso.
 */

/** Vite resolve `@/...` e o `server-only`, que o vinext troca por um shim. */
export async function createModuleLoader() {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    root,
    resolve: {
      alias: {
        "@": root,
        "server-only": path.join(root, "node_modules/vinext/dist/shims/server-only.js"),
      },
    },
    server: { middlewareMode: true },
  });

  return {
    load: (modulePath) => vite.ssrLoadModule(modulePath),
    close: () => vite.close(),
  };
}

async function applyMigrations(sqlite) {
  const directory = path.join(root, "drizzle");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();

  for (const file of files) {
    const contents = await readFile(path.join(directory, file), "utf8");
    for (const statement of contents.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

/**
 * Banco em memória com o schema aplicado a partir das migrações reais.
 *
 * Migrar pelos arquivos de `drizzle/` — e não por um DDL escrito à mão no teste
 * — faz o teste cobrir também a migração: um `db:generate` que produza SQL
 * inválido quebra aqui.
 */
export async function createTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  await applyMigrations(sqlite);

  const db = drizzle(async (sql, params, method) => {
    const statement = sqlite.prepare(sql);

    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }

    // O sqlite-proxy espera as colunas como array de valores na ordem do
    // SELECT. `node:sqlite` devolve objetos, e a ordem das chaves acompanha a
    // ordem das colunas retornadas.
    const rows = statement.all(...params).map((row) => Object.values(row));
    return method === "get" ? { rows: rows[0] ?? [] } : { rows };
  });

  return { db, sqlite, close: () => sqlite.close() };
}

/** Duas empresas independentes — a base de todo teste de isolamento. */
export function seedTwoOrganizations(sqlite) {
  const now = new Date().toISOString();

  const organizations = [
    { id: "org_alfa", name: "Alfa Arquitetura", slug: "alfa" },
    { id: "org_beta", name: "Beta Engenharia", slug: "beta" },
  ];

  for (const organization of organizations) {
    sqlite
      .prepare(
        "insert into organizations (id, name, slug, timezone, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
      )
      .run(organization.id, organization.name, organization.slug, "America/Sao_Paulo", now, now);
  }

  const members = [
    {
      id: "mem_alfa_owner",
      organizationId: "org_alfa",
      subject: "ana@alfa.test",
      name: "Ana",
      role: "owner",
    },
    {
      id: "mem_alfa_member",
      organizationId: "org_alfa",
      subject: "caio@alfa.test",
      name: "Caio",
      role: "member",
    },
    {
      id: "mem_beta_owner",
      organizationId: "org_beta",
      subject: "bruno@beta.test",
      name: "Bruno",
      role: "owner",
    },
  ];

  for (const member of members) {
    sqlite
      .prepare(
        `insert into members
         (id, organization_id, external_user_id, name, email, role, weekly_capacity_minutes, active, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        member.id,
        member.organizationId,
        member.subject,
        member.name,
        member.subject,
        member.role,
        2400,
        1,
        now,
        now,
      );
  }

  return { organizations, members };
}
