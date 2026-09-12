type StoredEvent = { id: string; event_type: string; payload_json: string; status: string };

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function chargeStatus(eventType: string, data: JsonRecord) {
  const explicit = text(data.status, data.state);
  if (explicit) return explicit.toLowerCase();
  if (eventType.endsWith(".paid")) return "paid";
  if (eventType.endsWith(".failed")) return "failed";
  if (eventType.endsWith(".refunded")) return "refunded";
  if (eventType.endsWith(".cancelled") || eventType.endsWith(".canceled")) return "cancelled";
  if (eventType.endsWith(".created")) return "created";
  return "updated";
}

async function finish(db: D1Database, eventId: string, status: "processed" | "ignored" | "failed", error: string | null) {
  await db.prepare("UPDATE integration_events SET status = ?1, processed_at = CURRENT_TIMESTAMP, error = ?2 WHERE id = ?3")
    .bind(status, error, eventId).run();
}

export async function processDrapEvent(db: D1Database, eventId: string, organizationId: string) {
  const event = await db.prepare(
    "SELECT id, event_type, payload_json, status FROM integration_events WHERE id = ?1 AND organization_id = ?2 AND provider = 'drap'",
  ).bind(eventId, organizationId).first<StoredEvent>();
  if (!event) return { status: "missing" as const };
  if (event.status === "processed" || event.status === "ignored") return { status: event.status as "processed" | "ignored" };

  let payload: JsonRecord;
  try { payload = record(JSON.parse(event.payload_json)); }
  catch { await finish(db, event.id, "failed", "invalid_json"); return { status: "failed" as const, error: "invalid_json" }; }

  const data = record(payload.data);
  try {
    if (event.event_type.startsWith("charge.")) {
      const externalId = text(data.id, data.charge_id, data.chargeId, payload.charge_id, payload.chargeId);
      if (!externalId) {
        await finish(db, event.id, "failed", "missing_external_charge_id");
        return { status: "failed" as const, error: "missing_external_charge_id" };
      }
      const status = chargeStatus(event.event_type, data);
      const shareUrl = text(data.share_url, data.shareUrl, data.url);
      const result = await db.prepare(
        `UPDATE financial_charge_requests SET status = ?1,
         share_url = COALESCE(?2, share_url), last_error = CASE WHEN ?1 = 'failed' THEN 'drap_event_failed' ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = ?3 AND external_charge_id = ?4`,
      ).bind(status, shareUrl, organizationId, externalId).run();
      if (!result.meta?.changes) {
        await finish(db, event.id, "failed", "charge_not_found");
        return { status: "failed" as const, error: "charge_not_found" };
      }
      await finish(db, event.id, "processed", null);
      return { status: "processed" as const };
    }

    // Eventos sem contrato local homologado continuam preservados para auditoria, mas não
    // alteram a verdade financeira. Isso evita inventar semântica para transaction/invoice.
    await finish(db, event.id, "ignored", "unsupported_event_type");
    return { status: "ignored" as const };
  } catch {
    await finish(db, event.id, "failed", "processing_error");
    return { status: "failed" as const, error: "processing_error" };
  }
}
