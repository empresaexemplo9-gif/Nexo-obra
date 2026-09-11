// Interface do banco usada por todo o produto.
//
// O nome vem do D1, porque foi onde o projeto começou. O banco hoje é libSQL/Turso, e
// `db/index.ts` expõe exatamente esta interface sobre ele — foi essa escolha que evitou
// reescrever as 52 rotas e bibliotecas ao trocar de provedor. O nome ficou; o runtime da
// Cloudflare, não.
interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}
