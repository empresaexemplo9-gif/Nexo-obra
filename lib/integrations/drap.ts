import { runtimeEnv as platformEnv } from "@/lib/server/runtime";

export type FinancialSummary = {
  currentBalance: number;
  receivables: number;
  payables: number;
  projected30d: number;
  overdueReceivables: number;
  updatedAt: string;
  source: "drap";
};

export type FinancialTransaction = {
  id: string;
  type: "receivable" | "payable";
  description: string;
  amount: number;
  dueDate: string | null;
  paidAt: string | null;
  status: "open" | "overdue" | "paid" | "cancelled";
  partyName: string | null;
  costCenterId: string | null;
};

export type DrapCharge = {
  id: string;
  status: string;
  shareUrl: string | null;
};

type DrapTenantConfig = {
  apiToken?: string;
  webhookSecret?: string;
};

type DrapRuntimeEnv = {
  DRAP_API_URL?: string;
  DRAP_API_TOKEN?: string;
  DRAP_API_KEY_HEADER?: string;
  DRAP_TRANSACTIONS_PATH?: string;
  DRAP_CHARGES_PATH?: string;
  DRAP_WEBHOOK_SECRET?: string;
  DRAP_TENANTS_JSON?: string;
};

function runtimeEnv() {
  return platformEnv() as unknown as DrapRuntimeEnv;
}

function tenantConfigs() {
  const raw = runtimeEnv().DRAP_TENANTS_JSON;
  if (!raw) return {} as Record<string, DrapTenantConfig>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, DrapTenantConfig>;
    const result: Record<string, DrapTenantConfig> = {};
    for (const [companyId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const apiToken = typeof entry.apiToken === "string" && entry.apiToken.trim() ? entry.apiToken.trim() : undefined;
      const webhookSecret = typeof entry.webhookSecret === "string" && entry.webhookSecret.trim() ? entry.webhookSecret.trim() : undefined;
      if (apiToken || webhookSecret) result[companyId] = { apiToken, webhookSecret };
    }
    return result;
  } catch {
    return {} as Record<string, DrapTenantConfig>;
  }
}

function apiTokenFor(externalCompanyId: string) {
  const config = runtimeEnv();
  const tenants = tenantConfigs();
  const tenantIds = Object.keys(tenants);
  if (tenantIds.length > 0) {
    const token = tenants[externalCompanyId]?.apiToken;
    if (!token) throw new Error("DRAP integration is not configured for this tenant");
    return token;
  }
  if (!config.DRAP_API_TOKEN) throw new Error("DRAP integration is not configured");
  return config.DRAP_API_TOKEN;
}

export function getDrapWebhookCandidates() {
  const config = runtimeEnv();
  const tenants = tenantConfigs();
  if (Object.keys(tenants).length > 0) {
    return Object.entries(tenants)
      .filter(([, value]) => Boolean(value.webhookSecret))
      .map(([externalCompanyId, value]) => ({ externalCompanyId, secret: value.webhookSecret as string }));
  }
  return config.DRAP_WEBHOOK_SECRET ? [{ externalCompanyId: "", secret: config.DRAP_WEBHOOK_SECRET }] : [];
}

export function isDrapConfigured() {
  const config = runtimeEnv();
  const hasTenantToken = Object.values(tenantConfigs()).some((entry) => Boolean(entry.apiToken));
  return Boolean(config.DRAP_API_URL && (config.DRAP_API_TOKEN || hasTenantToken));
}

export function isDrapTransactionsConfigured() {
  return isDrapConfigured();
}

export function isDrapChargesConfigured() {
  const config = runtimeEnv();
  return Boolean(config.DRAP_API_URL && config.DRAP_CHARGES_PATH && (config.DRAP_API_TOKEN || Object.values(tenantConfigs()).some((entry) => Boolean(entry.apiToken))));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseRemoteNumber(value: string) {
  const cleaned = value.trim().replace(/\s|R\$/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = parseRemoteNumber(value);
      if (parsed !== null) return parsed;
    }
  }
  return 0;
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return String(record[key]);
  return null;
}

function requestHeaders(externalCompanyId: string) {
  const config = runtimeEnv();
  const token = apiTokenFor(externalCompanyId);
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
  if (config.DRAP_API_KEY_HEADER) headers.set(config.DRAP_API_KEY_HEADER, token);
  else headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function drapUrl(path: string) {
  const base = runtimeEnv().DRAP_API_URL;
  if (!base) throw new Error("DRAP integration is not configured");
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
}

function transactionStatus(value: string | null): FinancialTransaction["status"] {
  const status = value?.toLowerCase();
  if (status === "paid" || status === "pago" || status === "settled") return "paid";
  if (status === "overdue" || status === "vencido") return "overdue";
  if (status === "cancelled" || status === "canceled" || status === "cancelado") return "cancelled";
  return "open";
}

function normalizeTransaction(value: unknown): FinancialTransaction | null {
  const item = asRecord(value);
  const id = readString(item, ["id", "transactionId", "transaction_id", "externalId"]);
  if (!id) return null;

  const rawType = readString(item, ["type", "kind", "nature", "tipo"])?.toLowerCase();
  const type = rawType === "payable" || rawType === "expense" || rawType === "pagar" || rawType === "despesa"
    ? "payable"
    : "receivable";

  return {
    id,
    type,
    description: readString(item, ["description", "descricao", "title", "name"]) ?? "Lançamento",
    amount: Math.max(0, readNumber(item, ["amount", "value", "valor", "total"])),
    dueDate: readString(item, ["dueDate", "due_date", "vencimento", "data_vencimento", "data"]),
    paidAt: readString(item, ["paidAt", "paid_at", "paymentDate", "data_pagamento"]),
    status: transactionStatus(readString(item, ["status", "situacao"])),
    partyName: readString(item, ["partyName", "party_name", "customerName", "supplierName", "cliente", "fornecedor", "contraparte"]),
    costCenterId: readString(item, ["costCenterId", "cost_center_id", "centro_custo_id"]),
  };
}

export async function fetchDrapTransactions(externalCompanyId: string, costCenterId?: string | null) {
  const config = runtimeEnv();
  if (!isDrapTransactionsConfigured()) throw new Error("DRAP transactions are not configured");

  const records: unknown[] = [];
  let offset = 0;
  let total: number | null = null;

  while (offset < 500 && (total === null || offset < total)) {
    const url = drapUrl(config.DRAP_TRANSACTIONS_PATH ?? "/api/v1/lancamentos");
    url.searchParams.set("limit", "100");
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url, { headers: requestHeaders(externalCompanyId), signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const suffix = response.status === 429 && retryAfter ? `; retry after ${retryAfter}s` : "";
      throw new Error(`DRAP transactions request failed with status ${response.status}${suffix}`);
    }

    const root = asRecord(await response.json());
    const page = [root.items, root.transactions, root.results, asRecord(root.data).items, root.data].find(Array.isArray) ?? [];
    const declaredTotal = root.total;
    if (typeof declaredTotal === "number" && Number.isFinite(declaredTotal) && declaredTotal >= 0) total = declaredTotal;
    if (typeof declaredTotal === "string") {
      const parsedTotal = Number(declaredTotal);
      if (Number.isFinite(parsedTotal) && parsedTotal >= 0) total = parsedTotal;
    }

    records.push(...page);
    if (page.length === 0 || page.length < 100) break;
    offset += page.length;
  }

  const normalized = records.slice(0, 500)
    .map(normalizeTransaction)
    .filter((item): item is FinancialTransaction => item !== null);

  // O contrato informado não documenta filtro por centro de custo no endpoint de
  // lançamentos. Quando a tela pede um projeto, filtramos somente pelo campo retornado;
  // nunca ampliamos silenciosamente para os lançamentos da empresa inteira.
  return costCenterId ? normalized.filter((item) => item.costCenterId === costCenterId) : normalized;
}

export async function fetchDrapFinancialSummary(externalCompanyId: string) {
  const transactions = await fetchDrapTransactions(externalCompanyId);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let currentBalance = 0;
  let receivables = 0;
  let payables = 0;
  let overdueReceivables = 0;
  let projected30d = 0;

  for (const item of transactions) {
    if (item.status === "cancelled") continue;
    const signed = item.type === "receivable" ? item.amount : -item.amount;
    if (item.status === "paid") currentBalance += signed;
    else if (item.type === "receivable") receivables += item.amount;
    else payables += item.amount;

    const overdue = item.status === "overdue" || (item.status === "open" && item.dueDate !== null && item.dueDate < todayKey);
    if (overdue && item.type === "receivable") overdueReceivables += item.amount;
    if (item.status !== "paid" && item.dueDate !== null && item.dueDate <= thirtyDays) projected30d += signed;
  }

  projected30d += currentBalance;
  return {
    currentBalance,
    receivables,
    payables,
    projected30d,
    overdueReceivables,
    updatedAt: new Date().toISOString(),
    source: "drap",
  } satisfies FinancialSummary;
}

export async function createDrapCharge(input: {
  externalCompanyId: string;
  externalCustomerId: string;
  costCenterId: string;
  description: string;
  amountCents: number;
  dueDate: string;
  idempotencyKey: string;
  reminders: { daysBefore: number; onDueDate: boolean; overdueIntervalDays: number };
}) {
  const config = runtimeEnv();
  if (!isDrapChargesConfigured() || !config.DRAP_CHARGES_PATH) throw new Error("DRAP charges are not configured");
  const headers = requestHeaders(input.externalCompanyId);
  headers.set("Idempotency-Key", input.idempotencyKey);
  const response = await fetch(drapUrl(config.DRAP_CHARGES_PATH), {
    method: "POST",
    headers,
    body: JSON.stringify({
      customer_id: input.externalCustomerId,
      cost_center_id: input.costCenterId,
      description: input.description,
      amount_cents: input.amountCents,
      due_date: input.dueDate,
      reminder_policy: {
        days_before: input.reminders.daysBefore,
        on_due_date: input.reminders.onDueDate,
        overdue_interval_days: input.reminders.overdueIntervalDays,
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`DRAP charge request failed with status ${response.status}`);
  const root = asRecord(await response.json());
  const data = asRecord(root.data ?? root.charge ?? root);
  const id = readString(data, ["id", "chargeId", "charge_id"]);
  if (!id) throw new Error("DRAP charge response has no id");
  const shareUrl = readString(data, ["shareUrl", "share_url", "paymentUrl", "payment_url"]);
  return { id, status: readString(data, ["status", "situacao"]) ?? "created", shareUrl: shareUrl && /^https:\/\//i.test(shareUrl) ? shareUrl : null } satisfies DrapCharge;
}

export class DrapApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
    public retryAfter: string | null,
  ) {
    super(`DRAP API request failed with status ${status}`);
  }
}

export async function requestDrapApi<T>(
  externalCompanyId: string,
  path: string,
  init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<{ data: T | null; status: number; retryAfter: string | null }> {
  if (!isDrapConfigured()) throw new Error("DRAP integration is not configured");
  const method = init.method ?? "GET";
  const response = await fetch(drapUrl(path), {
    method,
    headers: requestHeaders(externalCompanyId),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(method === "GET" ? 8000 : 10000),
  });

  const retryAfter = response.headers.get("retry-after");
  const text = response.status === 204 ? "" : await response.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); }
    catch { parsed = { error: text.slice(0, 500) }; }
  }

  if (!response.ok) throw new DrapApiError(response.status, parsed, retryAfter);
  return { data: parsed as T | null, status: response.status, retryAfter };
}
