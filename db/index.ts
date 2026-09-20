import type { Client, InArgs } from "@libsql/client";
import { drizzle } from "drizzle-orm/d1";

import { ApiError } from "@/lib/server/api-error";
import { runtimeEnv } from "@/lib/server/runtime";
import * as schema from "./schema";

// Banco de dados sobre libSQL, mantendo a mesma interface que as 52 rotas e bibliotecas
// já usam (`prepare().bind().all()`, `first()`, `run()`, `batch()`).
//
// A alternativa seria trocar para Postgres, o que exigiria reescrever o SQL de todos esses
// arquivos e das 15 migrações: `?1` como marcador, `INSERT OR IGNORE`, `substr`,
// `CURRENT_TIMESTAMP` como texto, `ON CONFLICT` no dialeto do SQLite. libSQL fala o mesmo
// SQLite, então nada disso muda — a migração de plataforma não vira reescrita do produto.

type Row = Record<string, unknown>;
type Result<T> = { results: T[]; success: boolean; meta: Record<string, unknown> };
type Settings = { url: string; authToken?: string; source: string };

// Nomes diretos, em ordem de precedência. Os `TURSO_*` são os que a integração
// Turso↔Vercel injeta sozinha.
const URL_KEYS = ["DATABASE_URL", "TURSO_DATABASE_URL", "TURSO_CONNECTION_URL"] as const;
const TOKEN_KEYS = ["DATABASE_AUTH_TOKEN", "TURSO_AUTH_TOKEN"] as const;

function unconfigured(): never {
  // Antes isto era um `Error` comum, e `apiRoute` o transformava em
  // "Não foi possível concluir a operação." — um problema de configuração chegava à tela
  // como falha genérica, sem dizer o que faltava. Custou horas de diagnóstico às cegas.
  throw new ApiError(
    503,
    "database_not_configured",
    "O banco de dados não está configurado nesta publicação. Defina DATABASE_URL (ou conecte a integração Turso, que injeta TURSO_DATABASE_URL) e publique de novo.",
    { procurou: [...URL_KEYS, "<PREFIXO>_DATABASE_URL", "<PREFIXO>_CONNECTION_URL"] },
  );
}

// Resolve a configuração a partir do ambiente. Uma integração do marketplace pode
// prefixar as variáveis que cria (`vercel integration resource connect --prefix`), então
// nomes fixos não bastam: qualquer chave terminada em DATABASE_URL/CONNECTION_URL cujo
// valor pareça uma URL de banco serve, e o token é procurado sob o mesmo prefixo.
export function databaseSettings(env: Record<string, string | undefined> = runtimeEnv()): Settings | null {
  const token = () => TOKEN_KEYS.map((key) => env[key]).find(Boolean);
  for (const key of URL_KEYS) {
    const url = env[key]?.trim();
    if (url) return { url, authToken: token(), source: key };
  }
  for (const [key, raw] of Object.entries(env)) {
    if (!/(?:^|_)(?:DATABASE|CONNECTION)_URL$/.test(key)) continue;
    const url = raw?.trim();
    if (!url || !/^(?:libsql|wss?|https?|file):/i.test(url)) continue;
    const prefix = key.replace(/(?:DATABASE|CONNECTION)_URL$/, "");
    return { url, authToken: env[`${prefix}AUTH_TOKEN`]?.trim() || token(), source: key };
  }
  return null;
}

let client: Client | null = null;
let openedUrl = "";

/** Release the cached connection during shutdown or after an embedded database test. */
export function closeDatabase(): void {
  client?.close();
  client = null;
  openedUrl = "";
}

async function libsql(): Promise<Client> {
  const settings = databaseSettings();
  if (!settings) unconfigured();
  // Uma troca de URL em desenvolvimento precisa reabrir a conexão.
  if (client && openedUrl === settings.url) return client;
  // `@libsql/client` resolve para o cliente de Node, que carrega o pacote nativo `libsql`
  // para atender `file:`. Numa função serverless isso é peso morto e um risco de empacote
  // — o binário nativo pode não ser rastreado para o bundle, e aí toda rota quebra com
  // erro de módulo. Para banco remoto existe `/web`, que é só HTTP e não tem nativo.
  const remote = !settings.url.toLowerCase().startsWith("file:");
  const { createClient } = remote
    ? await import("@libsql/client/web")
    : await import("@libsql/client");
  client = createClient({ url: settings.url, authToken: settings.authToken });
  openedUrl = settings.url;
  return client;
}

function statement(sql: string, args: InArgs = []) {
  const bound = args;
  const execute = async () => (await libsql()).execute({ sql, args: bound });
  return {
    bind(...values: unknown[]) {
      // Array posicional, nunca objeto. Um objeto `{1: v, 2: v}` vira parâmetro NOMEADO:
      // o cliente web empacota como `namedArgs: [{name: "1"}]` e o servidor responde
      // "named parameter 1 at position 1 has no binding", porque `?1` é numerado, não
      // nomeado. O cliente nativo resolvia o objeto sozinho, então o defeito só aparecia
      // em produção — os testes rodam sobre `file:`, que usa o nativo.
      return statement(sql, values as InArgs);
    },
    async all<T = Row>(): Promise<Result<T>> {
      const result = await execute();
      return { results: result.rows as unknown as T[], success: true, meta: { changes: result.rowsAffected } };
    },
    async first<T = Row>(column?: string): Promise<T | null> {
      const result = await execute();
      const row = result.rows[0];
      if (!row) return null;
      return (column ? (row as unknown as Row)[column] : row) as T;
    },
    async run<T = Row>(): Promise<Result<T>> {
      const result = await execute();
      return { results: result.rows as unknown as T[], success: true, meta: { changes: result.rowsAffected } };
    },
    async raw<T = unknown[]>(): Promise<T[]> {
      const result = await execute();
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
    const results = await (await libsql()).batch(
      statements.map((item) => ({ sql: item.__sql, args: item.__args })),
      "write",
    );
    return results.map((result) => ({
      results: result.rows as unknown as T[], success: true, meta: { changes: result.rowsAffected },
    }));
  },
  async exec(sql: string) {
    const started = Date.now();
    await (await libsql()).executeMultiple(sql);
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
