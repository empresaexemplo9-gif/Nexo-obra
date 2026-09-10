// Aplicação das migrações dentro da própria plataforma.
//
// O `db:generate` só escreve os arquivos em `drizzle/`. Nada no deploy os aplica, então
// um banco sem eles derruba toda funcionalidade nova com "no such table". Este módulo
// embute o SQL no bundle, registra o que já foi aplicado e aplica o que falta.

const files = import.meta.glob("../../drizzle/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export type MigrationFile = { id: string; statements: string[] };

export const migrations: MigrationFile[] = Object.entries(files)
  .map(([path, sql]) => ({
    id: path.split("/").pop()!.replace(/\.sql$/, ""),
    statements: sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean),
  }))
  .sort((left, right) => left.id.localeCompare(right.id));

const LEDGER = `CREATE TABLE IF NOT EXISTS _platform_migrations (
  id text PRIMARY KEY NOT NULL,
  statements integer NOT NULL,
  skipped integer NOT NULL DEFAULT 0,
  applied_at integer NOT NULL
)`;

// Só erro de "já existe" é tolerado. Um banco onde as tabelas foram criadas antes do
// registro passa a ser reconhecido sem que nada seja recriado; qualquer outra falha sobe.
function alreadySatisfied(error: unknown) {
  const message = String(error).toLowerCase();
  return message.includes("already exists")
    || message.includes("duplicate column")
    || message.includes("duplicate index");
}

export async function migrationStatus(db: D1Database) {
  await db.prepare(LEDGER).run();
  const applied = await db.prepare("SELECT id, applied_at FROM _platform_migrations").all<{ id: string; applied_at: number }>();
  const appliedIds = new Set(applied.results.map((row) => row.id));
  return {
    applied: applied.results.map((row) => ({ id: row.id, appliedAt: row.applied_at })).sort((a, b) => a.id.localeCompare(b.id)),
    pending: migrations.filter((migration) => !appliedIds.has(migration.id)).map((migration) => migration.id),
    total: migrations.length,
  };
}

export async function applyMigrations(db: D1Database) {
  const status = await migrationStatus(db);
  const results: Array<{ id: string; statements: number; skipped: number }> = [];

  for (const id of status.pending) {
    const migration = migrations.find((item) => item.id === id)!;
    let skipped = 0;
    for (const statement of migration.statements) {
      try {
        await db.prepare(statement).run();
      } catch (error) {
        if (!alreadySatisfied(error)) {
          throw new Error(`Falha na migração ${id}: ${String(error)}`);
        }
        skipped += 1;
      }
    }
    await db.prepare("INSERT OR REPLACE INTO _platform_migrations (id, statements, skipped, applied_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(id, migration.statements.length, skipped, Date.now()).run();
    results.push({ id, statements: migration.statements.length, skipped });
  }

  return { applied: results, pending: (await migrationStatus(db)).pending };
}
