import { z } from "zod";

import { apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { isDrapChargesConfigured, isDrapConfigured, isDrapTransactionsConfigured } from "@/lib/integrations/drap";

export const dynamic = "force-dynamic";

const connectionSchema = z.object({ externalCompanyId: z.string().trim().min(1).max(160) });

type ConnectionRow = { id: string; external_company_id: string; status: string; last_synced_at: string | null; last_error: string | null };

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const connection = await context.db.prepare("SELECT id, external_company_id, status, last_synced_at, last_error FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1").bind(context.organization.id).first<ConnectionRow>();
    return Response.json({
      connection: connection ? { id: connection.id, externalCompanyId: connection.external_company_id, status: connection.status, lastSyncedAt: connection.last_synced_at, lastError: connection.last_error } : null,
      capabilities: { summary: isDrapConfigured(), transactions: isDrapTransactionsConfigured(), charges: isDrapChargesConfigured() },
    });
  });
}

export async function PUT(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");
    const parsed = connectionSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const existing = await context.db.prepare("SELECT id FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap'").bind(context.organization.id).first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    await context.db.batch([
      context.db.prepare(`INSERT INTO integration_connections (id, organization_id, provider, external_company_id, status, last_synced_at, last_error, created_at, updated_at) VALUES (?1, ?2, 'drap', ?3, 'active', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(organization_id, provider) DO UPDATE SET external_company_id = excluded.external_company_id, status = 'active', last_error = NULL, updated_at = CURRENT_TIMESTAMP`).bind(id, context.organization.id, parsed.data.externalCompanyId),
      auditStatement(context, existing ? "integration.drap_updated" : "integration.drap_connected", "integration_connection", id),
    ]);
    return Response.json({ connection: { id, externalCompanyId: parsed.data.externalCompanyId, status: "active", lastSyncedAt: null, lastError: null } });
  });
}
