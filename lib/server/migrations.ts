// Aplicação das migrações dentro da própria plataforma.
//
// O `db:generate` só escreve os arquivos em `drizzle/`. Nada no deploy os aplica, então
// um banco sem eles derruba toda funcionalidade nova com "no such table". Este módulo
// embute o SQL no bundle, registra o que já foi aplicado e aplica o que falta.
//
// O SQL vem de `drizzle/manifest.ts`, gerado por `scripts/build-migrations-manifest.mjs`.
// Antes vinha de `import.meta.glob`, que é do Vite e não existe no `next build`.

import { migrationSources } from "@/drizzle/manifest";

export type MigrationFile = { id: string; statements: string[] };

export const migrations: MigrationFile[] = migrationSources
  .map(([id, sql]) => ({
    id,
    statements: sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean),
  }))
  .sort((left, right) => left.id.localeCompare(right.id));

// O portão do superadministrador registra tentativas de senha no banco. Num banco ainda
// não migrado essa tabela não existe, e o login falhava — mas só o login dá acesso à
// rota que migra. Era um impasse: nem migrar sem entrar, nem entrar sem migrar.
// Por isso o próprio portão garante a sua tabela, de forma idempotente.
export const LOGIN_ATTEMPTS_TABLE = `CREATE TABLE IF NOT EXISTS superadmin_login_attempts (
  fingerprint text PRIMARY KEY NOT NULL,
  failed_count integer DEFAULT 0 NOT NULL,
  window_started_at integer NOT NULL,
  locked_until integer DEFAULT 0 NOT NULL,
  updated_at integer NOT NULL
)`;

export async function ensureLoginAttemptsTable(db: D1Database) {
  await db.prepare(LOGIN_ATTEMPTS_TABLE).run();
}

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

// ── Aplicação automática ────────────────────────────────────────────────────────────
//
// O agendamento (de hora em hora pelo GitHub Actions, diário pela Vercel) aplica sozinho
// só o que acrescenta: tabela, índice ou coluna nova. Isso não toca em dado existente.
// Migração que apaga, renomeia, reconstrói tabela ou mexe em linhas espera a aplicação
// manual no painel — alguém precisa ler antes, porque desfazer não é automático.

const ADITIVA = /^\s*(PRAGMA\s+optimize\b|CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?[`"]?(?!__new_)[\w]+|CREATE\s+(UNIQUE\s+)?INDEX\b|ALTER\s+TABLE\s+[`"]?\w+[`"]?\s+ADD\b)/i;

export function motivoParaRevisao(migration: MigrationFile): string | null {
  const instrucao = migration.statements.find((statement) => !ADITIVA.test(statement));
  if (!instrucao) return null;
  const inicio = instrucao.replace(/\s+/g, " ").slice(0, 80);
  return `${migration.id} tem instrução que altera dado ou estrutura existente (${inicio}…). Aplique pelo painel depois de revisar.`;
}

const TRAVA = `CREATE TABLE IF NOT EXISTS _platform_migration_lock (
  id integer PRIMARY KEY NOT NULL,
  token text,
  locked_until integer NOT NULL DEFAULT 0,
  last_run_at integer,
  last_origin text,
  last_result text,
  last_error text
)`;

/**
 * Executa `tarefa` com a trava do banco. O agendamento e o botão do painel não aplicam
 * migração ao mesmo tempo: quem chega com a trava ocupada recebe `null`.
 */
async function comTrava<T>(db: D1Database, tarefa: () => Promise<T>): Promise<T | null> {
  await db.prepare(TRAVA).run();
  await db.prepare("INSERT OR IGNORE INTO _platform_migration_lock (id, locked_until) VALUES (1, 0)").run();
  const token = crypto.randomUUID();
  const agora = Date.now();
  const tomada = await db.prepare("UPDATE _platform_migration_lock SET token = ?1, locked_until = ?2 WHERE id = 1 AND locked_until < ?3")
    .bind(token, agora + 5 * 60_000, agora).run();
  if (!tomada.meta?.changes) return null;
  try { return await tarefa(); }
  finally { await db.prepare("UPDATE _platform_migration_lock SET locked_until = 0 WHERE id = 1 AND token = ?1").bind(token).run(); }
}

async function registrarExecucao(db: D1Database, origem: string, resultado: string, erro: string | null) {
  await db.prepare("UPDATE _platform_migration_lock SET last_run_at = ?1, last_origin = ?2, last_result = ?3, last_error = ?4 WHERE id = 1")
    .bind(Date.now(), origem, resultado, erro).run();
}

export async function ultimaExecucao(db: D1Database) {
  await db.prepare(TRAVA).run();
  const linha = await db.prepare("SELECT last_run_at, last_origin, last_result, last_error FROM _platform_migration_lock WHERE id = 1")
    .first<{ last_run_at: number | null; last_origin: string | null; last_result: string | null; last_error: string | null }>();
  return linha?.last_run_at ? { at: linha.last_run_at, origin: linha.last_origin ?? "", result: linha.last_result ?? "", error: linha.last_error } : null;
}

/** O que o agendamento roda: aplica as pendentes aditivas, em ordem, e para na primeira que precisa de revisão. */
export async function atualizarAutomaticamente(db: D1Database, origem: string) {
  const resultado = await comTrava(db, async () => {
    const status = await migrationStatus(db);
    const aplicaveis: string[] = [];
    let revisao: string | null = null;
    // Em ordem: uma migração posterior pode depender da que precisa de revisão.
    for (const id of status.pending) {
      const motivo = motivoParaRevisao(migrations.find((m) => m.id === id)!);
      if (motivo) { revisao = motivo; break; }
      aplicaveis.push(id);
    }
    try {
      const aplicado = aplicaveis.length ? await applyMigrations(db, aplicaveis) : { applied: [], pending: status.pending };
      const texto = aplicado.applied.length ? `Aplicadas: ${aplicado.applied.map((m) => m.id).join(", ")}.` : "Nada a aplicar.";
      await registrarExecucao(db, origem, revisao ? `${texto} Aguardando revisão manual.` : texto, revisao);
      return { ran: true as const, applied: aplicado.applied, pending: aplicado.pending, needsReview: revisao };
    } catch (error) {
      await registrarExecucao(db, origem, "Falhou.", String(error).slice(0, 500));
      throw error;
    }
  });
  return resultado ?? { ran: false as const, applied: [], pending: (await migrationStatus(db)).pending, needsReview: null, busy: true };
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

export async function applyMigrations(db: D1Database, somente?: string[]) {
  const status = await migrationStatus(db);
  const results: Array<{ id: string; statements: number; skipped: number }> = [];

  for (const id of status.pending.filter((pendente) => !somente || somente.includes(pendente))) {
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

/** Aplicação manual pelo painel: todas as pendentes, sob a mesma trava do agendamento. */
export async function aplicarPeloPainel(db: D1Database, origem: string) {
  const resultado = await comTrava(db, async () => {
    try {
      const aplicado = await applyMigrations(db);
      await registrarExecucao(db, origem, aplicado.applied.length ? `Aplicadas: ${aplicado.applied.map((m) => m.id).join(", ")}.` : "Nada a aplicar.", null);
      return aplicado;
    } catch (error) {
      await registrarExecucao(db, origem, "Falhou.", String(error).slice(0, 500));
      throw error;
    }
  });
  return resultado;
}
