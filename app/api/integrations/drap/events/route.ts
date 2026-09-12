import { z } from "zod";

import { getDatabase } from "@/db";
import { apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { processDrapEvent } from "@/lib/server/drap-events";

export const dynamic = "force-dynamic";

const retrySchema = z.object({ eventId: z.string().trim().min(1).max(200) });

type EventRow = {
  id: string; event_type: string; status: string; processed_at: string | null;
  error: string | null; created_at: string;
};

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const status = new URL(request.url).searchParams.get("status")?.trim();
    const values: unknown[] = [context.organization.id];
    const filter = status ? (values.push(status), ` AND status = ?${values.length}`) : "";
    const result = await context.db.prepare(
      `SELECT id, event_type, status, processed_at, error, created_at
       FROM integration_events WHERE organization_id = ?1 AND provider = 'drap'${filter}
       ORDER BY created_at DESC LIMIT 200`,
    ).bind(...values).all<EventRow>();
    return Response.json({ events: result.results.map((row) => ({
      id: row.id, eventType: row.event_type, status: row.status,
      processedAt: row.processed_at, error: row.error, createdAt: row.created_at,
    })) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "edit");
    const parsed = retrySchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    await context.db.prepare(
      "UPDATE integration_events SET status = 'received', processed_at = NULL, error = NULL WHERE id = ?1 AND organization_id = ?2 AND provider = 'drap'",
    ).bind(parsed.data.eventId, context.organization.id).run();
    const processing = await processDrapEvent(getDatabase(), parsed.data.eventId, context.organization.id);
    await context.db.batch([
      auditStatement(context, "drap.event_reprocessed", "integration_event", parsed.data.eventId, { status: processing.status }),
    ]);
    return Response.json({ eventId: parsed.data.eventId, status: processing.status, error: "error" in processing ? processing.error : null });
  });
}
