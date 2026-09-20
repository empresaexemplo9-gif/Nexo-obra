import { z } from "zod";
import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { requireSuperAdmin, rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { pricingCatalog, changePricingRule } from "@/lib/server/drap-pricing";
import { activationFor, activationConfigured } from "@/lib/server/activation";
import { isDrapPartnerConfigured } from "@/lib/integrations/drap-partner";
import { guardaDeSegredosConfigurada } from "@/lib/server/segredos";

export const dynamic = "force-dynamic";
const schema = z.object({ organizationId: z.string().uuid(), planId: z.string().min(1).max(120), multiplierBps: z.number().int().min(10000).max(100000), revision: z.number().int().min(0) }).strict();
async function company(id: string) {
  if (!z.string().uuid().safeParse(id).success || !await getDatabase().prepare("SELECT id FROM organizations WHERE id = ?1").bind(id).first()) throw new ApiError(404, "not_found", "Empresa não encontrada.");
}
export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const organizationId = new URL(request.url).searchParams.get("organizationId") ?? ""; await company(organizationId);
    const [catalog, activation, events] = await Promise.all([
      pricingCatalog(organizationId), activationFor(organizationId),
      getDatabase().prepare(`SELECT id, action, actor_user_id, entity_id, metadata_json, created_at FROM platform_audit_events
        WHERE organization_id = ?1 AND action IN ('drap.pricing_changed', 'drap.pricing_locked', 'drap.activation_confirmed') ORDER BY created_at DESC LIMIT 100`).bind(organizationId).all(),
    ]);
    const commission = activation?.base_cents !== null && activation?.base_cents !== undefined && activation.monthly_cents !== null
      ? { baseCents: activation.base_cents, monthlyCents: activation.monthly_cents, commissionCents: Math.max(0, activation.monthly_cents - activation.base_cents), subscriptionId: activation.subscription_id, status: activation.status } : null;
    return Response.json({ catalog, commission, events: events.results, readiness: { provisioning: isDrapPartnerConfigured() && guardaDeSegredosConfigurada(), activation: activationConfigured() } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request); const admin = await requireSuperAdmin(request);
    const parsed = schema.safeParse(await jsonBody(request)); if (!parsed.success) throw validationError(parsed.error.flatten());
    const data = parsed.data; await company(data.organizationId);
    const rule = await changePricingRule(data.organizationId, data.planId, data.multiplierBps, data.revision, admin.email);
    return Response.json({ rule }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
