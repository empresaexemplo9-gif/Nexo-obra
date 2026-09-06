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

type DrapRuntimeEnv = {
  DRAP_API_URL?: string;
  DRAP_API_TOKEN?: string;
  DRAP_API_KEY_HEADER?: string;
  DRAP_SUMMARY_PATH?: string;
  DRAP_TRANSACTIONS_PATH?: string;
  DRAP_CHARGES_PATH?: string;
  DRAP_WEBHOOK_SECRET?: string;
};

function runtimeEnv() {
  return env as unknown as DrapRuntimeEnv;
}

export function isDrapConfigured() {
  const config = runtimeEnv();
  return Boolean(config.DRAP_API_URL && config.DRAP_API_TOKEN);
}

export function isDrapTransactionsConfigured() {
  const config = runtimeEnv();
  return Boolean(config.DRAP_API_URL && config.DRAP_API_TOKEN && config.DRAP_TRANSACTIONS_PATH);
}

export function isDrapChargesConfigured() {
  const config = runtimeEnv();
  return Boolean(config.DRAP_API_URL && config.DRAP_API_TOKEN && config.DRAP_CHARGES_PATH);
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

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return String(record[key]);
  return null;
}

function requestHeaders() {
  const config = runtimeEnv();
  if (!config.DRAP_API_TOKEN) throw new Error("DRAP integration is not configured");
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
  if (config.DRAP_API_KEY_HEADER) headers.set(config.DRAP_API_KEY_HEADER, config.DRAP_API_TOKEN);
  else headers.set("Authorization", `Bearer ${config.DRAP_API_TOKEN}`);
  return headers;
}

function drapUrl(path: string) {
  const base = runtimeEnv().DRAP_API_URL;
  if (!base) throw new Error("DRAP integration is not configured");
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
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

  const path = (config.DRAP_SUMMARY_PATH ?? "/api/v1/finance/summary").replace(/^\//, "");
  const url = drapUrl(path);
  url.searchParams.set("company_id", externalCompanyId);

  const response = await fetch(url, {
    method: "GET",
    headers: requestHeaders(),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`DRAP summary request failed with status ${response.status}`);
  }

  return normalizeSummary(await response.json());
}

function transactionStatus(value: string | null): FinancialTransaction["status"] {
  const status = value?.toLowerCase();
  if (status === "paid" || status === "pago" || status === "settled") return "paid";
  if (status === "overdue" || status === "vencido") return "overdue";
  if (status === "cancelled" || status === "canceled" || status === "cancelado") return "cancelled";
  return "open";
}

export async function fetchDrapTransactions(externalCompanyId: string, costCenterId?: string | null) {
  const config = runtimeEnv();
  if (!isDrapTransactionsConfigured() || !config.DRAP_TRANSACTIONS_PATH) throw new Error("DRAP transactions are not configured");
  const url = drapUrl(config.DRAP_TRANSACTIONS_PATH);
  url.searchParams.set("company_id", externalCompanyId);
  if (costCenterId) url.searchParams.set("cost_center_id", costCenterId);
  const response = await fetch(url, { headers: requestHeaders(), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`DRAP transactions request failed with status ${response.status}`);
  const root = asRecord(await response.json());
  const records = [root.transactions, root.items, root.results, asRecord(root.data).items, root.data].find(Array.isArray) ?? [];
  return (records as unknown[]).slice(0, 500).map((value): FinancialTransaction | null => {
    const item = asRecord(value);
    const id = readString(item, ["id", "transactionId", "transaction_id", "externalId"]);
    const rawType = readString(item, ["type", "kind", "nature", "tipo"])?.toLowerCase();
    const type = rawType === "payable" || rawType === "expense" || rawType === "pagar" || rawType === "despesa" ? "payable" : "receivable";
    if (!id) return null;
    return {
      id,
      type,
      description: readString(item, ["description", "descricao", "title", "name"]) ?? "Lançamento",
      amount: Math.max(0, readNumber(item, ["amount", "value", "valor", "total"])),
      dueDate: readString(item, ["dueDate", "due_date", "vencimento"]),
      paidAt: readString(item, ["paidAt", "paid_at", "paymentDate", "data_pagamento"]),
      status: transactionStatus(readString(item, ["status", "situacao"])),
      partyName: readString(item, ["partyName", "party_name", "customerName", "supplierName", "cliente", "fornecedor"]),
      costCenterId: readString(item, ["costCenterId", "cost_center_id", "centro_custo_id"]),
    };
  }).filter((item): item is FinancialTransaction => item !== null);
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
  const headers = requestHeaders();
  headers.set("Idempotency-Key", input.idempotencyKey);
  const response = await fetch(drapUrl(config.DRAP_CHARGES_PATH), {
    method: "POST",
    headers,
    body: JSON.stringify({
      company_id: input.externalCompanyId,
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

export function getDrapWebhookSecret() {
  return runtimeEnv().DRAP_WEBHOOK_SECRET ?? null;
}
