import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { activationConfigured, activationFor } from "@/lib/server/activation";
import { DRAP_CATALOG, DRAP_CATALOG_CHECKED_AT, DRAP_CATALOG_SOURCE } from "@/lib/integrations/drap-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const [activation, connection] = await Promise.all([
      activationFor(context.organization.id),
      context.db.prepare("SELECT external_company_id, status FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1")
        .bind(context.organization.id).first<{ external_company_id: string; status: string }>(),
    ]);

    return Response.json({
      catalog: DRAP_CATALOG,
      source: DRAP_CATALOG_SOURCE,
      checkedAt: DRAP_CATALOG_CHECKED_AT,
      pricing: "same_as_drap",
      embeddedExperience: true,
      requiresRedirect: false,
      checkoutAvailable: activationConfigured(),
      tenantProvisioned: Boolean(connection?.external_company_id),
      connectionStatus: connection?.status ?? null,
      subscription: activation ? {
        planId: activation.plan_id,
        status: activation.status,
        monthlyCents: activation.monthly_cents,
        subscriptionId: activation.subscription_id,
        lastError: activation.last_error,
      } : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
