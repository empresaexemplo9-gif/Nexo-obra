import { and, eq } from "drizzle-orm";

import { getDatabase, getDb } from "@/db";
import { integrationConnections, integrationEvents } from "@/db/schema";
import { getDrapWebhookCandidatesAsync } from "@/lib/integrations/drap";
import { processDrapEvent } from "@/lib/server/drap-events";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;

function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  return bytes;
}

async function verifySignature(payload: string, timestamp: string, signatureHeader: string, secret: string) {
  const signature = hexToBytes(signatureHeader.replace(/^sha256=/i, "").trim());
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${timestamp}.${payload}`);
  return crypto.subtle.verify("HMAC", key, signature, signed);
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseTimestamp(value: string | null) {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return timestamp;
}

async function boundedText(request: Request) {
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (announced > MAX_WEBHOOK_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request) {
  // Inclui os segredos das empresas que registraram o webhook sozinhas ao conectar, não
  // só os colados à mão no painel de publicação.
  const candidates = await getDrapWebhookCandidatesAsync();
  if (candidates.length === 0) return Response.json({ error: "Webhook secret is not configured" }, { status: 503 });

  const signature = request.headers.get("x-drap-signature");
  const timestampHeader = request.headers.get("x-drap-timestamp");
  if (!signature || !timestampHeader) return Response.json({ error: "Missing Drap signature headers" }, { status: 401 });

  const timestamp = parseTimestamp(timestampHeader);
  if (timestamp === null) return Response.json({ error: "Invalid Drap timestamp" }, { status: 401 });
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) return Response.json({ error: "Expired Drap webhook" }, { status: 401 });

  const rawPayload = await boundedText(request);
  if (rawPayload === null) return Response.json({ error: "Payload too large" }, { status: 413 });

  const matched = [] as typeof candidates;
  for (const candidate of candidates) {
    if (await verifySignature(rawPayload, timestampHeader.trim(), signature, candidate.secret)) matched.push(candidate);
  }
  if (matched.length === 0) return Response.json({ error: "Invalid signature" }, { status: 401 });
  if (matched.length > 1) return Response.json({ error: "Ambiguous Drap webhook secret" }, { status: 409 });

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawPayload) as Record<string, unknown>; }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const eventType = typeof payload.event === "string" ? payload.event.trim() : "";
  const payloadTimestamp = typeof payload.timestamp === "number"
    ? payload.timestamp
    : typeof payload.timestamp === "string" && /^\d+$/.test(payload.timestamp) ? Number(payload.timestamp) : null;
  if (!eventType || payloadTimestamp !== timestamp) {
    return Response.json({ error: "Invalid Drap event envelope" }, { status: 400 });
  }

  try {
    const db = getDb();
    const tenantCompanyId = matched[0].externalCompanyId;
    let connection: { id: string; organizationId: string } | undefined;

    if (tenantCompanyId) {
      [connection] = await db.select({
        id: integrationConnections.id,
        organizationId: integrationConnections.organizationId,
      }).from(integrationConnections)
        .where(and(
          eq(integrationConnections.provider, "drap"),
          eq(integrationConnections.status, "active"),
          eq(integrationConnections.externalCompanyId, tenantCompanyId),
        ))
        .limit(1);
    } else {
      // Compatibilidade com a configuração legada de um único token/secret global.
      // Se houver mais de uma empresa ativa, falha fechado para não misturar tenants.
      const legacyConnections = await db.select({
        id: integrationConnections.id,
        organizationId: integrationConnections.organizationId,
      }).from(integrationConnections)
        .where(and(eq(integrationConnections.provider, "drap"), eq(integrationConnections.status, "active")))
        .limit(2);
      if (legacyConnections.length > 1) return Response.json({ error: "Ambiguous Drap tenant configuration" }, { status: 409 });
      connection = legacyConnections[0];
    }

    if (!connection) return Response.json({ error: "No active Drap connection" }, { status: 404 });

    const eventId = `drap_${await sha256Hex(`${timestampHeader.trim()}.${rawPayload}`)}`;
    await db.insert(integrationEvents).values({
      id: eventId,
      organizationId: connection.organizationId,
      provider: "drap",
      eventType,
      payload: rawPayload,
      status: "received",
    }).onConflictDoNothing({ target: integrationEvents.id });

    const processing = await processDrapEvent(getDatabase(), eventId, connection.organizationId);
    return Response.json({ accepted: true, eventId, processing: processing.status }, { status: 202 });
  } catch {
    return Response.json({ error: "Event storage unavailable" }, { status: 503 });
  }
}
