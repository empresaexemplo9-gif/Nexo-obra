import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Database = ReturnType<typeof getDb>;

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

/**
 * Versão tolerante para telas que precisam renderizar mesmo sem banco.
 *
 * A leitura de `env.DB` já falha fora do runtime do Worker (build, testes de
 * módulo), então a checagem inteira fica dentro do try.
 */
export function getDbOrNull() {
  try {
    return getDb();
  } catch {
    return null;
  }
}
