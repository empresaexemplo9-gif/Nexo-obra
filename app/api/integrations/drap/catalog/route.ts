import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { activationConfigured, activationFor } from "@/lib/server/activation";
import { DRAP_CATALOG_CHECKED_AT, DRAP_CATALOG_SOURCE } from "@/lib/integrations/drap-catalog";
import { drapPrice, pricingCatalog } from "@/lib/server/drap-pricing";
import { isDrapPartnerConfigured } from "@/lib/integrations/drap-partner";
import { guardaDeSegredosConfigurada } from "@/lib/server/segredos";
import { podeAdministrarEmpresa } from "@/lib/permissions";

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
    const tenantProvisioned = Boolean(connection?.external_company_id);
    const prices = await pricingCatalog(context.organization.id);
    const selection = await context.db.prepare("SELECT metadata_json FROM audit_events WHERE organization_id = ?1 AND action = 'drap.selection_saved' ORDER BY created_at DESC, id DESC LIMIT 1").bind(context.organization.id).first<{ metadata_json: string }>();

    return Response.json({
      catalog: prices.map(item => ({ id: item.id, name: item.name, kind: item.kind, monthlyCents: item.monthlyCents, trialDays: item.trialDays, modules: item.modules, description: item.description, ...(item.annualCents ? { annualCents: drapPrice(item.annualCents, item.multiplierBps).monthlyCents } : {}) })),
      source: DRAP_CATALOG_SOURCE,
      checkedAt: DRAP_CATALOG_CHECKED_AT,
      pricing: "company_offer",
      canManage: podeAdministrarEmpresa(context.member.role) && context.member.permissions.finance.edit,
      provisioningAvailable: isDrapPartnerConfigured() && guardaDeSegredosConfigurada(),
      selection: selection ? JSON.parse(selection.metadata_json).itemIds : [],
      embeddedExperience: true,
      requiresRedirect: !tenantProvisioned,
      signupAvailable: true,
      checkoutAvailable: activationConfigured(),
      tenantProvisioned,
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
