import { createClient, type Client, type InArgs } from "@libsql/client";
import { drizzle } from "drizzle-orm/d1";

import { runtimeEnv } from "@/lib/server/runtime";
import * as schema from "./schema";

// Banco de dados sobre libSQL, mantendo a mesma interface que as 52 rotas e bibliotecas
// já usam (`prepare().bind().all()`, `first()`, `run()`, `batch()`).
//
// A alternativa seria trocar para Postgres, o que exigiria reescrever o SQL de todos esses
// arquivos e das 15 migrações: `?1` como marcador, `INSERT OR IGNORE`, `substr`,
// `CURRENT_TIMESTAMP` como texto, `ON CONFLICT` no dialeto do SQLite. libSQL fala o mesmo
// SQLite, então nada disso muda — a migração de plataforma não vira reescrita do produto.
//
// Configuração:
//   DATABASE_URL        libsql://<banco>.turso.io  (ou file:./local.db em desenvolvimento)
//   DATABASE_AUTH_TOKEN token do banco remoto (dispensável no arquivo local)

type Row = Record<string, unknown>;
type Result<T> = { results: T[]; success: boolean; meta: Record<string, unknown> };

let client: Client | null = null;
let describedUrl = "";

function libsql(): Client {
  const env = runtimeEnv();
  const url = env.DATABASE_URL ?? env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não está configurada. Use libsql://<banco>.turso.io em produção ou file:./local.db em desenvolvimento.",
    );
  }
  // Uma troca de URL em desenvolvimento precisa reabrir a conexão.
  if (client && describedUrl === url) return client;
  client = createClient({ url, authToken: env.DATABASE_AUTH_TOKEN ?? env.TURSO_AUTH_TOKEN });
  describedUrl = url;
  return client;
}

function statement(sql: string, args: InArgs = []) {
  const bound = args;
  return {
    bind(...values: unknown[]) {
      // As consultas usam marcadores posicionais (?1, ?2…), que o libSQL recebe como objeto.
      return statement(sql, Object.fromEntries(values.map((value, index) => [index + 1, value as never])) as InArgs);
    },
    async all<T = Row>(): Promise<Result<T>> {
      const result = await libsql().execute({ sql, args: bound });
      return { results: result.rows as unknown as T[], success: true, meta: { changes: result.rowsAffected } };
    },
    async first<T = Row>(column?: string): Promise<T | null> {
      const result = await libsql().execute({ sql, args: bound });
      const row = result.rows[0];
      if (!row) return null;
      return (column ? (row as unknown as Row)[column] : row) as T;
    },
    async run<T = Row>(): Promise<Result<T>> {
      const result = await libsql().execute({ sql, args: bound });
      return { results: result.rows as unknown as T[], success: true, meta: { changes: result.rowsAffected } };
    },
    async raw<T = unknown[]>(): Promise<T[]> {
      const result = await libsql().execute({ sql, args: bound });
      return result.rows.map((row) => Object.values(row)) as T[];
    },
    // Usado pelo batch para montar a transação sem reexecutar.
    __sql: sql,
    __args: bound,
  };
}

type Prepared = ReturnType<typeof statement>;

const database = {
  prepare(sql: string) { return statement(sql); },
  async batch<T = Row>(statements: Prepared[]): Promise<Result<T>[]> {
    // `batch` do libSQL é transacional, como o do D1: tudo ou nada.
    const results = await libsql().batch(
      statements.map((item) => ({ sql: item.__sql, args: item.__args })),
      "write",
    );
    return results.map((result) => ({
      results: result.rows as unknown as T[], success: true, meta: { changes: result.rowsAffected },
    }));
  },
  async exec(sql: string) {
    const started = Date.now();
    await libsql().executeMultiple(sql);
    return { count: 1, duration: Date.now() - started };
  },
};

export function getDatabase(): D1Database {
  // Em teste, o banco é injetado no ambiente e nenhuma conexão real é aberta.
  const injected = (runtimeEnv() as unknown as { DB?: D1Database }).DB;
  if (injected) return injected;
  return database as unknown as D1Database;
}

// O construtor de consultas do Drizzle fala com a mesma interface, então ele continua
// funcionando sobre o adaptador — tanto em produção quanto com o banco injetado em teste.
export function getDb() {
  return drizzle(getDatabase(), { schema });
}
