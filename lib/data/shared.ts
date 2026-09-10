import "server-only";

/**
 * Carimbos de tempo em ISO-8601 UTC.
 *
 * As colunas têm `DEFAULT CURRENT_TIMESTAMP`, que o SQLite grava como
 * "2026-03-17 12:00:00" — formato que ordena diferente de "2026-03-17T12:00:00Z"
 * na comparação de texto. Para `ORDER BY updated_at` continuar correto, a camada
 * de dados sempre grava o carimbo explicitamente neste formato, em vez de
 * deixar cair no default.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Nenhuma listagem volta sem limite. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
