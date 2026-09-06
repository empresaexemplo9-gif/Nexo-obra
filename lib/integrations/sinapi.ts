import { env } from "cloudflare:workers";

export type SinapiItem = {
  code: string;
  description: string;
  unit: string;
  unitCostCents: number;
  referenceMonth: string;
  state: string;
  sourceReference: string;
};

type SinapiRuntimeEnv = {
  SINAPI_API_URL?: string;
  SINAPI_API_TOKEN?: string;
  SINAPI_API_KEY_HEADER?: string;
  SINAPI_SEARCH_PATH?: string;
};

function runtimeEnv() {
  return env as unknown as SinapiRuntimeEnv;
}

export function isSinapiConfigured() {
  const config = runtimeEnv();
  return Boolean(config.SINAPI_API_URL && config.SINAPI_API_TOKEN);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return String(record[key]);
  return "";
}

function priceInCents(record: Record<string, unknown>) {
  const value = record.unitCostCents ?? record.unit_cost_cents ?? record.priceCents ?? record.preco_centavos;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const decimal = record.unitCost ?? record.unit_cost ?? record.price ?? record.preco ?? record.valor;
  if (typeof decimal === "number" && Number.isFinite(decimal)) return Math.max(0, Math.round(decimal * 100));
  if (typeof decimal === "string") {
    const normalized = Number(decimal.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(normalized) ? Math.max(0, Math.round(normalized * 100)) : 0;
  }
  return 0;
}

export async function searchSinapiItems(query: string, state: string, referenceMonth: string): Promise<SinapiItem[]> {
  const config = runtimeEnv();
  if (!config.SINAPI_API_URL || !config.SINAPI_API_TOKEN) throw new Error("SINAPI integration is not configured");
  const url = new URL((config.SINAPI_SEARCH_PATH ?? "/items/search").replace(/^\//, ""), config.SINAPI_API_URL.endsWith("/") ? config.SINAPI_API_URL : `${config.SINAPI_API_URL}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("uf", state);
  url.searchParams.set("reference_month", referenceMonth);
  const headers = new Headers({ Accept: "application/json" });
  headers.set(config.SINAPI_API_KEY_HEADER || "Authorization", config.SINAPI_API_KEY_HEADER ? config.SINAPI_API_TOKEN : `Bearer ${config.SINAPI_API_TOKEN}`);
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`SINAPI search failed with status ${response.status}`);
  const root = asRecord(await response.json());
  const rawItems = [root.items, root.results, asRecord(root.data).items, root.data].find(Array.isArray) ?? [];
  return (rawItems as unknown[]).slice(0, 50).map((value) => {
    const item = asRecord(value);
    const code = firstString(item, ["code", "codigo", "itemCode"]);
    return {
      code,
      description: firstString(item, ["description", "descricao", "name"]),
      unit: firstString(item, ["unit", "unidade"]) || "un",
      unitCostCents: priceInCents(item),
      referenceMonth: firstString(item, ["referenceMonth", "reference_month", "competencia"]) || referenceMonth,
      state: firstString(item, ["state", "uf"]) || state,
      sourceReference: firstString(item, ["sourceReference", "source_reference", "reference"]) || `${state}:${referenceMonth}:${code}`,
    };
  }).filter((item) => item.code && item.description);
}
