import { runtimeEnv } from "@/lib/server/runtime";
import type { Profile } from "./sinapi-contract";
import type { ItemSinapi } from "./sinapi-planilha";

export const ORCAMENTADOR_BASE_URL = "https://orcamentador.com.br/api";
export const ORCAMENTADOR_SOURCE_COMMIT = "db5e9129446ec96c66341f0c323c20a8e52b265d";
export const ORCAMENTADOR_SIGNATURE = `orcamentador-sdk:${ORCAMENTADOR_SOURCE_COMMIT}:codigo-descricao-unidade-preco:v1`;
const ORCAMENTADOR_PAGE_LIMIT = 100;

type JsonRecord = Record<string, unknown>;
type FetchResult = { items: ItemSinapi[]; ignored: number };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function firstText(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim();
  }
  return "";
}

function priceToCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value !== "string") return null;
  const clean = value.replace(/[R$\s ]/g, "");
  if (!clean || !/\d/.test(clean)) return null;
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  let normalized = clean;
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    normalized = clean.split(decimal === "," ? "." : ",").join("").replace(decimal, ".");
  } else if (comma >= 0) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  }
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}

function rawArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  for (const key of ["items", "results", "resultados", "insumos", "composicoes", "data", "dados"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  for (const key of ["data", "dados", "result", "resultado"]) {
    const nested = asRecord(root[key]);
    for (const child of ["items", "results", "resultados", "insumos", "composicoes", "data", "dados"]) {
      if (Array.isArray(nested[child])) return nested[child] as unknown[];
    }
  }
  return [];
}

function totalPages(payload: unknown): number | null {
  const root = asRecord(payload);
  const candidates = [root.pagination, root.paginacao, root.meta, asRecord(root.data).pagination, asRecord(root.data).meta];
  for (const value of candidates) {
    const page = asRecord(value);
    for (const key of ["total_pages", "totalPages", "last_page", "lastPage", "paginas"]) {
      const number = Number(page[key]);
      if (Number.isInteger(number) && number > 0) return number;
    }
  }
  return null;
}

export function orcamentadorConfig() {
  const env = runtimeEnv();
  return {
    baseUrl: env.SINAPI_API_URL?.trim() || ORCAMENTADOR_BASE_URL,
    token: env.SINAPI_API_TOKEN?.trim() || "",
    apiKeyHeader: env.SINAPI_API_KEY_HEADER?.trim() || "X-API-Key",
    searchPath: env.SINAPI_SEARCH_PATH?.trim() || "/insumos",
  };
}

export function isOrcamentadorConfigured() {
  return Boolean(orcamentadorConfig().token);
}

export function orcamentadorSourceUrl() {
  return orcamentadorConfig().baseUrl.replace(/\/$/, "");
}

export async function orcamentadorGet(path: string, params: Record<string, string | number | undefined> = {}) {
  const config = orcamentadorConfig();
  if (!config.token) throw new Error("SINAPI_API_TOKEN não está configurado para o Orçamentador.");
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL(path.replace(/^\//, ""), base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && String(value) !== "") url.searchParams.set(key, String(value));
  const headers = new Headers({ Accept: "application/json" });
  headers.set(config.apiKeyHeader, config.token);
  const response = await fetch(url, { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    let detail = "";
    try {
      const body = asRecord(await response.json());
      detail = firstText(body, ["erro", "message", "mensagem"]);
    } catch {}
    throw new Error(`Orçamentador respondeu HTTP ${response.status}${detail ? `: ${detail}` : ""}.`);
  }
  return response.json() as Promise<unknown>;
}

function normalizeItem(value: unknown, tipo: "insumo" | "composicao", regime: Profile["regime"]): ItemSinapi | null {
  const item = asRecord(value);
  const codigo = firstText(item, ["codigo", "code", "itemCode", "codigo_sinapi", "cod"]);
  const descricao = firstText(item, ["descricao", "description", "nome", "name", "discriminacao"]);
  const unidade = firstText(item, ["unidade", "unit", "und", "un"]) || "un";
  const directCents = item.preco_centavos ?? item.custo_centavos ?? item.unitCostCents ?? item.unit_cost_cents;
  let cents = typeof directCents === "number" && Number.isFinite(directCents) && directCents >= 0 ? Math.round(directCents) : null;
  const regimePriceKeys = regime === "Desonerado"
    ? ["preco_desonerado", "custo_desonerado", "valor_desonerado"]
    : ["preco_naodesonerado", "preco_nao_desonerado", "custo_naodesonerado", "custo_nao_desonerado", "valor_naodesonerado", "valor_nao_desonerado"];
  if (cents === null) {
    for (const key of [...regimePriceKeys, "preco", "preco_unitario", "preco_mediano", "custo", "custo_unitario", "valor", "price", "unitCost", "unit_cost"]) {
      cents = priceToCents(item[key]);
      if (cents !== null) break;
    }
  }
  if (!codigo || !descricao || cents === null) return null;
  return { codigo, descricao, unidade, custoUnitarioCentavos: cents, tipo };
}

function commonParams(profile: Profile, month: string) {
  return {
    estado: profile.uf.toUpperCase(),
    regime: profile.regime === "Desonerado" ? "DESONERADO" : "NAO_DESONERADO",
    data_ref: `${month}-01`,
  };
}

async function fetchPaged(path: string, tipo: "insumo" | "composicao", profile: Profile, month: string): Promise<FetchResult> {
  const items: ItemSinapi[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  let previousFingerprint = "";
  for (let page = 1; page <= 500; page++) {
    const payload = await orcamentadorGet(path, {
      ...commonParams(profile, month),
      page,
      limit: ORCAMENTADOR_PAGE_LIMIT,
      sort: "codigo",
      order: "asc",
    });
    const raw = rawArray(payload);
    if (!raw.length) break;
    const normalized = raw.map((value) => normalizeItem(value, tipo, profile.regime));
    const pageItems = normalized.filter((value): value is ItemSinapi => Boolean(value));
    ignored += raw.length - pageItems.length;
    const fingerprint = `${raw.length}:${pageItems[0]?.codigo ?? ""}:${pageItems.at(-1)?.codigo ?? ""}`;
    if (page > 1 && fingerprint === previousFingerprint) break;
    previousFingerprint = fingerprint;
    for (const item of pageItems) {
      const key = `${item.tipo}:${item.codigo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    const pages = totalPages(payload);
    if (pages !== null && page >= pages) break;
    if (pages === null && raw.length < ORCAMENTADOR_PAGE_LIMIT) break;
  }
  return { items, ignored };
}

export async function fetchOrcamentadorMonthlySnapshot(profile: Profile, month: string) {
  const insumos = await fetchPaged("/insumos", "insumo", profile, month);
  const composicoes = await fetchPaged("/composicoes", "composicao", profile, month);
  const encargos = await orcamentadorGet("/encargos", { estado: profile.uf.toUpperCase(), data_ref: `${month}-01` });
  const indicadores = await orcamentadorGet("/indicadores", { indicadores: "incc,incc_acumulado,ipca,igpm,selic,dolar" });
  return {
    items: [...insumos.items, ...composicoes.items],
    ignored: insumos.ignored + composicoes.ignored,
    parametros: { encargos, indicadores },
  };
}

async function searchEndpoint(
  path: string,
  tipo: "insumo" | "composicao",
  query: string,
  state: string,
  referenceMonth: string,
  regime: Profile["regime"],
) {
  const numeric = /^\d+$/.test(query.trim());
  const payload = await orcamentadorGet(path, {
    [numeric ? "codigo" : "nome"]: query.trim(),
    estado: state.toUpperCase(),
    regime: regime === "Desonerado" ? "DESONERADO" : "NAO_DESONERADO",
    data_ref: `${referenceMonth}-01`,
    modo_busca: numeric ? undefined : "contem",
    page: 1,
    limit: 50,
    sort: "codigo",
    order: "asc",
  });
  return rawArray(payload)
    .map((value) => normalizeItem(value, tipo, regime))
    .filter((value): value is ItemSinapi => Boolean(value));
}

export async function searchOrcamentadorItems(query: string, state: string, referenceMonth: string, regime: Profile["regime"]) {
  const config = orcamentadorConfig();
  const targets: Array<[string, "insumo" | "composicao"]> = config.searchPath === "/insumos"
    ? [["/insumos", "insumo"], ["/composicoes", "composicao"]]
    : [[config.searchPath, config.searchPath.toLowerCase().includes("compos") ? "composicao" : "insumo"]];
  const groups = await Promise.all(targets.map(([path, tipo]) => searchEndpoint(path, tipo, query, state, referenceMonth, regime)));
  const seen = new Set<string>();
  const items: ItemSinapi[] = [];
  for (const item of groups.flat()) {
    const key = `${item.tipo}:${item.codigo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length === 50) break;
  }
  return items;
}
