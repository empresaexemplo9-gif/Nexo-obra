import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { integrationConnections, integrationEvents } from "@/db/schema";
import { getDrapWebhookSecret } from "@/lib/integrations/drap";

function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifySignature(payload: string, signatureHeader: string, secret: string) {
  const signature = hexToBytes(signatureHeader.replace(/^sha256=/i, "").trim());
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(payload),
  );
}

function eventFields(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : {};
  return {
    id: String(payload.id ?? payload.event_id ?? ""),
    type: String(payload.type ?? payload.event_type ?? "unknown"),
    externalCompanyId: String(
      payload.company_id ?? data.company_id ?? payload.companyId ?? data.companyId ?? "",
    ),
  };
}

export async function POST(request: Request) {
  const secret = getDrapWebhookSecret();
  if (!secret) {
    return Response.json({ error: "Webhook secret is not configured" }, { status: 503 });
  }

  const signature =
    request.headers.get("x-drap-signature") ??
    request.headers.get("x-webhook-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 401 });
  }

  const rawPayload = await request.text();
  if (!(await verifySignature(rawPayload, signature, secret))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawPayload) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = eventFields(payload);
  if (!event.id || !event.externalCompanyId) {
    return Response.json(
      { error: "Event id and company id are required" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const [connection] = await db
      .select({ organizationId: integrationConnections.organizationId })
      .from(integrationConnections)
      .where(eq(integrationConnections.externalCompanyId, event.externalCompanyId))
      .limit(1);

    if (!connection) {
      return Response.json({ error: "Unknown company" }, { status: 404 });
    }

    await db.insert(integrationEvents).values({
      id: event.id,
      organizationId: connection.organizationId,
      provider: "drap",
      eventType: event.type,
      payload: rawPayload,
      status: "received",
    }).onConflictDoNothing({ target: integrationEvents.id });

    return Response.json({ accepted: true, eventId: event.id }, { status: 202 });
  } catch {
    return Response.json({ error: "Event storage unavailable" }, { status: 503 });
  }
}
