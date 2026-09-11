import { ApiError, type OrganizationContext } from "@/lib/server/backend";

export type DrapConnectionRow = {
  id: string;
  external_company_id: string;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
};

export async function requireActiveDrapConnection(context: OrganizationContext) {
  const connection = await context.db.prepare(
    `SELECT id, external_company_id, status, last_synced_at, last_error
     FROM integration_connections
     WHERE organization_id = ?1 AND provider = 'drap'
     LIMIT 1`,
  ).bind(context.organization.id).first<DrapConnectionRow>();
  if (!connection || connection.status !== "active") {
    throw new ApiError(409, "drap_connection_required", "Conecte a empresa à Drap para continuar.");
  }
  return connection;
}
