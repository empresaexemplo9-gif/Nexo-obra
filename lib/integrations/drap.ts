import { env } from "cloudflare:workers";

export type FinancialSummary = {
  currentBalance: number;
  receivables: number;
  payables: number;
  projected30d: number;
  overdueReceivables: number;
  updatedAt: string;
  source: "drap";
};

type DrapRuntimeEnv = {
  DRAP_API_URL?: string;
  DRAP_API_TOKEN?: string;
  DRAP_API_KEY_HEADER?: string;
  DRAP_SUMMARY_PATH?: string;
  DRAP_WEBHOOK_SECRET?: string;
};

function runtimeEnv() {
  return env as unknown as DrapRuntimeEnv;
}

export function isDrapConfigured() {
  const config = runtimeEnv();
  return Boolean(config.DRAP_API_URL && config.DRAP_API_TOKEN);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const normalized = Number(value.replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(normalized)) return normalized;
    }
  }
  return 0;
}

function normalizeSummary(payload: unknown): FinancialSummary {
  const root = asRecord(payload);
  const data = asRecord(root.data ?? root.summary ?? root);

  return {
    currentBalance: readNumber(data, ["currentBalance", "current_balance", "saldoAtual", "saldo_atual"]),
    receivables: readNumber(data, ["receivables", "accountsReceivable", "contasReceber", "contas_a_receber"]),
    payables: readNumber(data, ["payables", "accountsPayable", "contasPagar", "contas_a_pagar"]),
    projected30d: readNumber(data, ["projected30d", "projectedBalance30d", "saldoProjetado30d", "saldo_projetado_30d"]),
    overdueReceivables: readNumber(data, ["overdueReceivables", "overdue", "recebiveisVencidos", "recebiveis_vencidos"]),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    source: "drap",
  };
}

export async function fetchDrapFinancialSummary(externalCompanyId: string) {
  const config = runtimeEnv();
  if (!config.DRAP_API_URL || !config.DRAP_API_TOKEN) {
    throw new Error("DRAP integration is not configured");
  }

  const baseUrl = config.DRAP_API_URL.endsWith("/")
    ? config.DRAP_API_URL
    : `${config.DRAP_API_URL}/`;
  const path = (config.DRAP_SUMMARY_PATH ?? "/api/v1/finance/summary").replace(/^\//, "");
  const url = new URL(path, baseUrl);
  url.searchParams.set("company_id", externalCompanyId);

  const headers = new Headers({ Accept: "application/json" });
  if (config.DRAP_API_KEY_HEADER) {
    headers.set(config.DRAP_API_KEY_HEADER, config.DRAP_API_TOKEN);
  } else {
    headers.set("Authorization", `Bearer ${config.DRAP_API_TOKEN}`);
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`DRAP summary request failed with status ${response.status}`);
  }

  return normalizeSummary(await response.json());
}

export function getDrapWebhookSecret() {
  return runtimeEnv().DRAP_WEBHOOK_SECRET ?? null;
}
