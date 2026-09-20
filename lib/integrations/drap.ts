import { runtimeEnv as platformEnv } from "@/lib/server/runtime";
import { camposDoCorpo, lerEnvelope } from "@/lib/drap-envelope";

export type FinancialSummary = {
  currentBalance: number;
  receivables: number;
  payables: number;
  projected30d: number;
  overdueReceivables: number;
  updatedAt: string;
  source: "drap";
  /** `resumo` = totais somados pela Drap. `lancamentos` = somados aqui, a
   *  partir da listagem, porque o endpoint de resumo ainda não respondeu. */
  origem: "resumo" | "lancamentos";
  /** Verdadeiro quando a soma cobriu só parte dos lançamentos. Número
   *  incompleto tem que se declarar; senão passa por número menor. */
  truncado: boolean;
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
  DRAP_PARTNER_TOKEN?: string;
  DRAP_SUMMARY_PATH?: string;
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

/**
 * Token de operação desta empresa.
 *
 * Ordem: ambiente primeiro, banco depois. O ambiente vence de propósito — quem configurou
 * à mão não muda de caminho por causa da tabela nova, e um segredo trocado no painel
 * continua sendo a saída de emergência.
 *
 * O banco entra para a empresa provisionada pela API de parceiro: a chave dela chega numa
 * resposta HTTP, uma vez só, e exigir um deploy para guardá-la anularia o provisionamento.
 * O `import` é dinâmico para o grafo estático deste módulo continuar sem banco.
 */
async function apiTokenFor(externalCompanyId: string) {
  const config = runtimeEnv();
  const tenants = tenantConfigs();
  const tenantIds = Object.keys(tenants);

  const doAmbiente = tenantIds.length > 0
    ? tenants[externalCompanyId]?.apiToken
    : config.DRAP_API_TOKEN;
  if (doAmbiente) return doAmbiente;

  const { tokenGuardado } = await import("@/lib/server/drap-credenciais");
  const guardado = await tokenGuardado(externalCompanyId);
  if (guardado) return guardado;

  throw new Error("DRAP integration is not configured for this tenant");
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

/**
 * Os segredos com que a Drap pode ter assinado a entrega que acabou de chegar: os do
 * ambiente mais os das empresas que registraram o webhook sozinhas ao conectar.
 *
 * Sem a parte do banco, o registro automático não serviria de nada: a assinatura chegaria
 * correta e o receptor a recusaria com 401, porque só conheceria os segredos colados à
 * mão no painel de publicação.
 *
 * O ambiente vem primeiro pela mesma razão de sempre — é a saída de emergência, e quem
 * trocou um segredo lá espera que ele valha. Empresa que aparece nos dois lugares é
 * conferida primeiro pelo do ambiente; como o receptor exige que exatamente um candidato
 * confira, um segredo velho no banco não cria ambiguidade: ele simplesmente não confere.
 *
 * O `import` é dinâmico para o grafo estático deste módulo continuar sem banco.
 */
export async function getDrapWebhookCandidatesAsync() {
  const doAmbiente = getDrapWebhookCandidates();
  const { segredosDeWebhookGuardados } = await import("@/lib/server/drap-credenciais");
  const doBanco = await segredosDeWebhookGuardados().catch(() => []);

  const vistos = new Set(doAmbiente.map((c) => `${c.externalCompanyId}:${c.secret}`));
  return [...doAmbiente, ...doBanco.filter((c) => !vistos.has(`${c.externalCompanyId}:${c.secret}`))];
}

export function isDrapConfigured() {
  const config = runtimeEnv();
  const hasTenantToken = Object.values(tenantConfigs()).some((entry) => Boolean(entry.apiToken));
  // `DRAP_PARTNER_TOKEN` conta como credencial configurada porque, com ele, as empresas
  // provisionadas guardam a chave delas no banco. Sem isso, uma instalação que só
  // provisiona apareceria como "integração não configurada" com tudo funcionando.
  const temParceiro = Boolean((config as { DRAP_PARTNER_TOKEN?: string }).DRAP_PARTNER_TOKEN);
  return Boolean(config.DRAP_API_URL && (config.DRAP_API_TOKEN || hasTenantToken || temParceiro));
}

export function isDrapTransactionsConfigured() {
  return isDrapConfigured();
}

/** A rota de cobrança existe na Drap desde `/api/v1/cobrancas`, então a
 *  capacidade deixa de depender de `DRAP_CHARGES_PATH` estar configurado —
 *  a variável segue aceita pra apontar outro caminho em homologação. */
export function isDrapChargesConfigured() {
  return isDrapConfigured();
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

async function requestHeaders(externalCompanyId: string) {
  const config = runtimeEnv();
  const token = await apiTokenFor(externalCompanyId);
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
    // `centro_custo` é o nome oficial da Drap — texto livre, não ID. Estava
    // fora desta lista, então TODO lançamento voltava com costCenterId nulo e
    // o recorte por obra devolvia vazio sem erro nenhum. Os outros nomes
    // continuam aceitos porque o adaptador atende contrato antigo também.
    costCenterId: readString(item, ["centro_custo", "costCenterId", "cost_center_id", "centro_custo_id"]),
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
    if (costCenterId) url.searchParams.set("centro_custo", costCenterId);

    const response = await fetch(url, { headers: await requestHeaders(externalCompanyId), signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const suffix = response.status === 429 && retryAfter ? `; retry after ${retryAfter}s` : "";
      throw new Error(`DRAP transactions request failed with status ${response.status}${suffix}`);
    }

    // A mesma leitura que a tela usa, em `lib/drap-envelope`: a regra estava escrita duas
    // vezes aqui dentro e uma terceira no componente, e três cópias divergem.
    const corpo = await response.json();
    const lido = lerEnvelope(corpo);
    // Envelope irreconhecível não é página vazia: seguir como se fosse entregaria lista
    // vazia sem erro nenhum — o defeito que o financeiro por obra já teve.
    if (!lido) throw new Error(`DRAP devolveu um envelope não reconhecido em ${url.pathname}. Campos: ${camposDoCorpo(corpo).join(", ") || "nenhum"}`);
    const page = lido.itens;
    if (lido.total !== null) total = lido.total;

    records.push(...page);
    if (page.length === 0 || page.length < 100) break;
    offset += page.length;
  }

  const normalized = records.slice(0, 500)
    .map(normalizeTransaction)
    .filter((item): item is FinancialTransaction => item !== null);

  // O filtro vai no servidor (acima) E é reaplicado aqui. Não é redundância:
  // servidor que ignora parâmetro desconhecido responde 200 com a lista
  // inteira, e sem esta segunda passada a tela da obra mostraria o financeiro
  // da empresa toda como se fosse dela. Nunca ampliamos o recorte em silêncio.
  return costCenterId ? normalized.filter((item) => item.costCenterId === costCenterId) : normalized;
}

/**
 * A empresa tem ALGUM lançamento na Drap?
 *
 * Serve pra uma pergunta só, e importante: quando o recorte por obra volta
 * vazio, isso é obra sem movimento ou centro de custo vinculado errado? As
 * duas situações desenham a mesma tela vazia, e só uma delas é problema. Uma
 * chamada com `limit=1` resolve — não pagina nada.
 */
export async function hasAnyDrapTransaction(externalCompanyId: string) {
  const config = runtimeEnv();
  if (!isDrapTransactionsConfigured()) throw new Error("DRAP transactions are not configured");

  const url = drapUrl(config.DRAP_TRANSACTIONS_PATH ?? "/api/v1/lancamentos");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { headers: await requestHeaders(externalCompanyId), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`DRAP transactions request failed with status ${response.status}`);

  const corpo = await response.json();
  const raiz = asRecord(corpo);
  // O total declarado vale mesmo quando a lista não veio nesta resposta: sem isto, uma
  // obra com movimento seria rotulada "sem movimento" em vez de "centro de custo errado".
  if (readNumber(raiz, ["total"]) > 0) return true;
  const lido = lerEnvelope(corpo);
  return (lido?.itens.length ?? 0) > 0;
}

/**
 * Resumo financeiro da empresa.
 *
 * Caminho oficial: a Drap soma e devolve pronto em `/api/v1/resumo`. Antes
 * desse endpoint existir, a única saída era paginar os lançamentos e somar
 * aqui — o que trunca em 500 e entrega um total menor com cara de certo.
 *
 * A soma local continua como plano B e SÓ pra um caso: a Drap respondeu 404,
 * isto é, o endpoint ainda não subiu naquele ambiente. Erro de credencial,
 * escopo ou rate-limit não cai pro plano B — a listagem bateria na mesma
 * parede, e insistir só transformaria um erro claro em um número torto.
 */
export async function fetchDrapFinancialSummary(externalCompanyId: string): Promise<FinancialSummary> {
  const oficial = await fetchDrapResumo(externalCompanyId);
  if (oficial) return oficial;
  return somarResumoPelosLancamentos(externalCompanyId);
}

type DrapResumo = {
  realizado?: { saldo?: unknown };
  em_aberto?: { a_receber?: unknown; a_pagar?: unknown };
  vencido?: { a_receber?: unknown; a_pagar?: unknown };
  proximos_30_dias?: { a_receber?: unknown; a_pagar?: unknown };
  truncado?: unknown;
  atualizado_em?: unknown;
};

/** `null` = endpoint ainda não existe neste ambiente (404). Qualquer outra
 *  falha sobe como erro. */
async function fetchDrapResumo(externalCompanyId: string): Promise<FinancialSummary | null> {
  const config = runtimeEnv();
  if (!isDrapConfigured()) throw new Error("DRAP integration is not configured");

  const url = drapUrl(config.DRAP_SUMMARY_PATH ?? "/api/v1/resumo");
  const response = await fetch(url, { headers: await requestHeaders(externalCompanyId), signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`DRAP summary request failed with status ${response.status}`);

  const corpo = (await response.json()) as DrapResumo;
  // Sem `realizado` no corpo não é a resposta que esperamos. Tratar como 404
  // em vez de somar zeros: zero é um número que a tela exibe sem desconfiar.
  if (!corpo || typeof corpo !== "object" || !corpo.realizado) return null;

  const saldo = readNumber(asRecord(corpo.realizado), ["saldo"]);
  const aReceber = readNumber(asRecord(corpo.em_aberto), ["a_receber"]);
  const aPagar = readNumber(asRecord(corpo.em_aberto), ["a_pagar"]);
  const vencidoReceber = readNumber(asRecord(corpo.vencido), ["a_receber"]);
  const vencidoPagar = readNumber(asRecord(corpo.vencido), ["a_pagar"]);
  const janelaReceber = readNumber(asRecord(corpo.proximos_30_dias), ["a_receber"]);
  const janelaPagar = readNumber(asRecord(corpo.proximos_30_dias), ["a_pagar"]);

  return {
    currentBalance: saldo,
    receivables: aReceber,
    payables: aPagar,
    overdueReceivables: vencidoReceber,
    // Projeção de 30 dias inclui o que já venceu e ainda está em aberto: é
    // dinheiro que a empresa espera movimentar, não histórico.
    projected30d: saldo + vencidoReceber + janelaReceber - vencidoPagar - janelaPagar,
    updatedAt: typeof corpo.atualizado_em === "string" ? corpo.atualizado_em : new Date().toISOString(),
    source: "drap",
    origem: "resumo",
    truncado: corpo.truncado === true,
  };
}

async function somarResumoPelosLancamentos(externalCompanyId: string): Promise<FinancialSummary> {
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
    origem: "lancamentos",
    // A paginação para em 500. Bateu no teto, a soma cobriu só parte da
    // empresa — e quem lê precisa saber disso.
    truncado: transactions.length >= 500,
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
  if (!isDrapChargesConfigured()) throw new Error("DRAP charges are not configured");

  const headers = await requestHeaders(input.externalCompanyId);
  // Sem esta chave, um timeout depois de a Drap aceitar deixa a H.OIKOS sem
  // resposta e o cliente com boleto emitido — e a retentativa manda o segundo.
  headers.set("Idempotency-Key", input.idempotencyKey);

  const response = await fetch(drapUrl(config.DRAP_CHARGES_PATH ?? "/api/v1/cobrancas"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      // O cliente é um parceiro da empresa no cadastro da Drap. Ela exige
      // CNPJ/CPF nele — sem documento o Asaas recusa, e a Drap devolve 422
      // dizendo qual parceiro completar.
      parceiro_id: input.externalCustomerId,
      descricao: input.description,
      // A Drap trabalha o valor em reais; aqui ele vive em centavos. A
      // conversão acontece só nesta borda.
      valor: input.amountCents / 100,
      vencimento: input.dueDate,
      // Deixa o pagador escolher entre PIX, boleto e cartão.
      forma: "UNDEFINED",
    }),
    signal: AbortSignal.timeout(10000),
  });

  // Dois campos do contrato da H.OIKOS não existem na cobrança da Drap e
  // ficam SÓ aqui, de propósito:
  //   - centro de custo: a cobrança da Drap não carrega obra. O vínculo por
  //     obra continua valendo pro lançamento, não pro boleto;
  //   - política de lembretes: quem lembra o cliente é a H.OIKOS, com os
  //     prazos gravados em financial_charge_requests.
  if (!response.ok) throw new Error(`DRAP charge request failed with status ${response.status}`);

  const root = asRecord(await response.json());
  const data = asRecord(root.cobranca ?? root.data ?? root.charge ?? root);
  const id = readString(data, ["id", "chargeId", "charge_id"]);
  if (!id) throw new Error("DRAP charge response has no id");

  // `invoice_url` é a página de pagamento da Drap/Asaas; o boleto puro serve
  // de segunda opção quando ela não vem.
  const shareUrl = readString(data, ["invoice_url", "invoiceUrl", "shareUrl", "share_url", "paymentUrl", "payment_url", "bank_slip_url", "bankSlipUrl"]);

  return {
    id,
    status: readString(data, ["status", "situacao"]) ?? "created",
    shareUrl: shareUrl && /^https:\/\//i.test(shareUrl) ? shareUrl : null,
  } satisfies DrapCharge;
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
  init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; idempotencyKey?: string } = {},
): Promise<{ data: T | null; status: number; retryAfter: string | null }> {
  if (!isDrapConfigured()) throw new Error("DRAP integration is not configured");
  const method = init.method ?? "GET";
  const headers = await requestHeaders(externalCompanyId);
  // Escrita financeira é operação distribuída (regra 5 do CLAUDE.md): um tempo esgotado
  // numa requisição que a Drap já efetivou faz a tentativa seguinte duplicar o registro.
  // `createDrapCharge` já mandava a chave; as rotas operacionais não mandavam nenhuma.
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  const response = await fetch(drapUrl(path), {
    method,
    headers,
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
