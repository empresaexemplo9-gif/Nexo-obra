type StoredEvent = { id: string; event_type: string; payload: string; status: string };

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
  if (eventType.endsWith(".paid") || eventType.endsWith(".paga")) return "paid";
  if (eventType.endsWith(".failed")) return "failed";
  if (eventType.endsWith(".refunded")) return "refunded";
  if (eventType.endsWith(".cancelled") || eventType.endsWith(".canceled") || eventType.endsWith(".cancelada")) return "cancelled";
  if (eventType.endsWith(".created") || eventType.endsWith(".criada")) return "created";
  return "updated";
}

async function finish(db: D1Database, eventId: string, status: "processed" | "ignored" | "failed", error: string | null) {
  await db.prepare("UPDATE integration_events SET status = ?1, processed_at = CURRENT_TIMESTAMP, error = ?2 WHERE id = ?3")
    .bind(status, error, eventId).run();
}

async function touchConnection(db: D1Database, organizationId: string) {
  await db.prepare(
    "UPDATE integration_connections SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE organization_id = ?1 AND provider = 'drap'",
  ).bind(organizationId).run();
}

export async function processDrapEvent(db: D1Database, eventId: string, organizationId: string) {
  const event = await db.prepare(
    "SELECT id, event_type, payload, status FROM integration_events WHERE id = ?1 AND organization_id = ?2 AND provider = 'drap'",
  ).bind(eventId, organizationId).first<StoredEvent>();
  if (!event) return { status: "missing" as const };
  if (event.status === "processed" || event.status === "ignored") return { status: event.status as "processed" | "ignored" };

  let payload: JsonRecord;
  try { payload = record(JSON.parse(event.payload)); }
  catch { await finish(db, event.id, "failed", "invalid_json"); return { status: "failed" as const, error: "invalid_json" }; }

  const data = record(payload.data);
  try {
    if (event.event_type.startsWith("lancamento.")) {
      const lancamento = record(data.lancamento);
      const externalId = text(lancamento.id);
      if (!externalId) {
        await finish(db, event.id, "failed", "missing_lancamento_id");
        return { status: "failed" as const, error: "missing_lancamento_id" };
      }
      // A Drap continua sendo a fonte financeira. O webhook apenas marca que há dado novo;
      // as telas consultam /lancamentos novamente em vez de criar uma segunda verdade local.
      await touchConnection(db, organizationId);
      await finish(db, event.id, "processed", null);
      return { status: "processed" as const };
    }

    if (event.event_type.startsWith("cobranca.") || event.event_type.startsWith("charge.")) {
      const cobranca = record(data.cobranca ?? data.charge ?? data);
      const externalId = text(cobranca.id, cobranca.charge_id, cobranca.chargeId, payload.charge_id, payload.chargeId);
      if (!externalId) {
        await finish(db, event.id, "failed", "missing_external_charge_id");
        return { status: "failed" as const, error: "missing_external_charge_id" };
      }
      const status = chargeStatus(event.event_type, cobranca);
      const shareUrl = text(cobranca.share_url, cobranca.shareUrl, cobranca.url);
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
      await touchConnection(db, organizationId);
      await finish(db, event.id, "processed", null);
      return { status: "processed" as const };
    }

    // Os demais eventos oficiais ficam preservados para auditoria. Eles não alteram dados
    // operacionais até existir uma regra de domínio explícita para parceiro, categoria,
    // conta bancária, NFS-e, orçamento ou anexo.
    await finish(db, event.id, "ignored", "unsupported_event_type");
    return { status: "ignored" as const };
  } catch {
    await finish(db, event.id, "failed", "processing_error");
    return { status: "failed" as const, error: "processing_error" };
  }
}
