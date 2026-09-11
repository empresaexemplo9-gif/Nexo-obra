import { runtimeEnv as platformEnv } from "@/lib/server/runtime";
import { z } from "zod";
import { getDatabase } from "@/db";
import { ApiError, validationError } from "@/lib/server/backend";

type Config = { DRAP_ACTIVATION_URL?: string; DRAP_ACTIVATION_TOKEN?: string; DRAP_ACTIVATION_WEBHOOK_SECRET?: string };
const config = () => platformEnv() as unknown as Config;
export function activationConfigured() { const c = config(); return Boolean(c.DRAP_ACTIVATION_URL && c.DRAP_ACTIVATION_TOKEN && c.DRAP_ACTIVATION_WEBHOOK_SECRET && c.DRAP_ACTIVATION_WEBHOOK_SECRET.length >= 32); }
export function architectorMonthlyCents(base: number) {
  if (!Number.isSafeInteger(base) || base < 0 || base > 100_000_000) throw new ApiError(400, "invalid_price", "Valor mensal inválido.");
  return Math.floor((base * 3 + 1) / 2);
}
export type Activation = { organization_id: string; company_id: string; plan_id: string; request_key: string; status: string;
  subscription_id: string | null; base_cents: number | null; monthly_cents: number | null; remote_revision: number; last_requested_at: number; last_error: string | null };
export async function activationFor(organizationId: string) {
  return getDatabase().prepare("SELECT * FROM drap_activations WHERE organization_id = ?1").bind(organizationId).first<Activation>();
}

// The Empresa service owns the plan catalog, subscription and actual invoices.
// Repeated requests use the persisted key, including after a network timeout.
export async function sendActivation(row: Activation) {
  const c = config();
  if (!activationConfigured()) throw new ApiError(503, "activation_not_configured", "A API de ativação do Drap Empresa ainda não foi conectada.");
  const url = new URL(c.DRAP_ACTIVATION_URL!);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "empresa.drap.app.br") throw new ApiError(503, "activation_invalid_url", "Configure um endpoint HTTPS do Drap Empresa.");
  const db = getDatabase();
  const claimed = await db.prepare(`UPDATE drap_activations SET last_requested_at = ?1 WHERE organization_id = ?2 AND last_requested_at <= ?3 RETURNING organization_id`)
    .bind(Date.now(), row.organization_id, Date.now() - 30_000).all();
  if (!claimed.results.length) throw new ApiError(429, "activation_wait", "Aguarde 30 segundos antes de reenviar.");
  try {
    const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${c.DRAP_ACTIVATION_TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": row.request_key },
      body: JSON.stringify({ product: "drap_architector", organizationId: row.organization_id, companyId: row.company_id, planId: row.plan_id,
        requestKey: row.request_key, currency: "BRL", interval: "month", pricingMultiplierBps: 15000, billingOwner: "drap_empresa" }) });
    if (!response.ok) throw new Error("remote_failure");
    await db.prepare("UPDATE drap_activations SET last_error = NULL WHERE organization_id = ?1").bind(row.organization_id).run();
    return { requested: true, awaitingConfirmation: row.status === "pending" };
  } catch {
    await db.prepare("UPDATE drap_activations SET last_error = ?1 WHERE organization_id = ?2")
      .bind("Confirmação pendente. Consulte o Empresa ou reenvie com a mesma chave.", row.organization_id).run();
    throw new ApiError(502, "activation_unconfirmed", "Não foi possível confirmar o envio. Reenviar reutiliza a mesma solicitação.");
  }
}

const eventSchema = z.object({ eventId: z.string().uuid(), organizationId: z.string().uuid(), requestKey: z.string().uuid(),
  companyId: z.string().min(1).max(120), planId: z.string().min(1).max(120), subscriptionId: z.string().min(1).max(160),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), status: z.enum(["active", "suspended", "canceled"]),
  baseMonthlyCents: z.number().int().min(0).max(100_000_000), monthlyCents: z.number().int().min(0).max(150_000_000),
  currency: z.literal("BRL"), interval: z.literal("month"), product: z.literal("drap_architector"), billingOwner: z.literal("drap_empresa"),
}).strict();

export async function receiveActivation(request: Request) {
  const secret = config().DRAP_ACTIVATION_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503, "activation_not_configured", "Integração não configurada.");
  const timestamp = request.headers.get("x-drap-timestamp") ?? "";
  const signature = request.headers.get("x-drap-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) throw new ApiError(401, "invalid_signature", "Assinatura inválida.");
  const reader = request.body?.getReader(); if (!reader) throw new ApiError(400, "empty_body", "Evento vazio.");
  let size = 0; const parts: Uint8Array[] = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 16384) { await reader.cancel(); throw new ApiError(413, "payload_too_large", "Evento muito grande."); } parts.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ApiError(400, "invalid_encoding", "O evento deve usar UTF-8."); }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(signature.match(/../g)!, (byte) => parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(`${timestamp}.${raw}`))) throw new ApiError(401, "invalid_signature", "Assinatura inválida.");
  let body: unknown; try { body = JSON.parse(raw); } catch { throw new ApiError(400, "invalid_json", "Evento inválido."); }
  const parsed = eventSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error.flatten());
  const data = parsed.data;
  if (data.monthlyCents !== architectorMonthlyCents(data.baseMonthlyCents)) throw new ApiError(409, "pricing_mismatch", "O total deve corresponder à mensalidade do Empresa acrescida de 50%.");
  const db = getDatabase(); const row = await activationFor(data.organizationId);
  if (!row || row.company_id !== data.companyId || (!row.subscription_id && row.plan_id !== data.planId) || row.request_key !== data.requestKey || (row.subscription_id && row.subscription_id !== data.subscriptionId)) throw new ApiError(409, "activation_mismatch", "Vínculo de ativação incompatível.");
  const connection = await db.prepare("SELECT external_company_id FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap'").bind(data.organizationId).first<{ external_company_id: string }>();
  if (connection && connection.external_company_id !== data.companyId) throw new ApiError(409, "connection_mismatch", "A conexão financeira existente pertence a outra empresa Drap.");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const previous = await db.prepare("SELECT digest FROM drap_activation_events WHERE id = ?1").bind(data.eventId).first<{ digest: string }>();
  if (previous) { if (previous.digest !== digest) throw new ApiError(409, "event_conflict", "ID de evento reutilizado com outro conteúdo."); return { received: true, duplicate: true }; }
  if (data.revision <= row.remote_revision) throw new ApiError(409, "stale_event", "A revisão já foi superada. Consulte o estado atual no Empresa.");
  try {
    await db.batch([
      db.prepare("INSERT INTO drap_activation_events (id, organization_id, digest, received_at) VALUES (?1, ?2, ?3, ?4)").bind(data.eventId, data.organizationId, digest, Date.now()),
      db.prepare(`UPDATE drap_activations SET status = ?1, subscription_id = ?2, base_cents = ?3, monthly_cents = ?4, remote_revision = ?5, last_error = NULL, updated_at = ?6, plan_id = ?8
        WHERE organization_id = ?7 AND remote_revision < ?5 AND (subscription_id IS NULL OR subscription_id = ?2)`)
        .bind(data.status, data.subscriptionId, data.baseMonthlyCents, data.monthlyCents, data.revision, Date.now(), data.organizationId, data.planId),
      db.prepare(`INSERT INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
        SELECT ?1, ?2, 'drap_empresa', 'drap.activation_confirmed', 'subscription', ?3, ?4, ?5 WHERE changes() > 0`)
        .bind(crypto.randomUUID(), data.organizationId, data.subscriptionId, JSON.stringify({ revision: data.revision, status: data.status, monthlyCents: data.monthlyCents }), Date.now()),
      db.prepare(`INSERT INTO integration_connections (id, organization_id, provider, external_company_id, status, last_synced_at)
        SELECT ?1, organization_id, 'drap', company_id, status, CURRENT_TIMESTAMP FROM drap_activations WHERE organization_id = ?2
        ON CONFLICT(organization_id, provider) DO UPDATE SET status = excluded.status, last_synced_at = excluded.last_synced_at, last_error = NULL
        WHERE integration_connections.external_company_id = excluded.external_company_id`)
        .bind(crypto.randomUUID(), data.organizationId),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "event_conflict", "Evento ou assinatura já registrado. Reenvie o mesmo evento para consultar o resultado.");
    throw error;
  }
  return { received: true };
}
