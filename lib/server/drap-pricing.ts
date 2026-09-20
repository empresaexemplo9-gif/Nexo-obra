import { getDatabase } from "@/db";
import { ApiError } from "@/lib/server/backend";
import { drapCatalogItem, DRAP_CATALOG } from "@/lib/integrations/drap-catalog";

// Políticas são eventos imutáveis no histórico administrativo já existente. O número
// de eventos é a revisão; a escrita condicional impede que duas telas se sobrescrevam.
export function drapPrice(baseCents: number, multiplierBps = 10000) {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0 || baseCents > 100_000_000 || !Number.isSafeInteger(multiplierBps) || multiplierBps < 10000 || multiplierBps > 100000) {
    throw new ApiError(400, "invalid_drap_price", "O preço mínimo é o valor oficial Drap. Informe um acréscimo entre 0% e 900%.");
  }
  const total = Math.round(baseCents * multiplierBps / 10000);
  if (!Number.isSafeInteger(total) || total > 150_000_000) throw new ApiError(400, "invalid_drap_price", "O total excede o limite da integração.");
  return { baseCents, monthlyCents: total, commissionCents: total - baseCents };
}

export async function pricingRule(organizationId: string, planId: string) {
  const rows = await getDatabase().prepare(`SELECT metadata_json FROM platform_audit_events
    WHERE organization_id = ?1 AND action = 'drap.pricing_changed' AND entity_id = ?2 ORDER BY created_at DESC, id DESC`)
    .bind(organizationId, planId).all<{ metadata_json: string }>();
  let multiplierBps = 10000;
  if (rows.results.length) multiplierBps = JSON.parse(rows.results[0].metadata_json).multiplierBps;
  drapPrice(0, multiplierBps);
  return { multiplierBps, revision: rows.results.length };
}

export async function pricingCatalog(organizationId: string) {
  return Promise.all(DRAP_CATALOG.map(async item => {
    const rule = await pricingRule(organizationId, item.id);
    return { ...item, ...drapPrice(item.monthlyCents, rule.multiplierBps), ...rule };
  }));
}

export async function changePricingRule(organizationId: string, planId: string, multiplierBps: number, revision: number, actor: string) {
  const item = drapCatalogItem(planId);
  if (!item) throw new ApiError(400, "invalid_drap_catalog_item", "Selecione um item do catálogo Drap.");
  if (item.kind === "free" && multiplierBps !== 10000) throw new ApiError(400, "free_plan", "O plano gratuito permanece sem acréscimo.");
  drapPrice(item.monthlyCents, multiplierBps);
  const db = getDatabase();
  const result = await db.prepare(`INSERT INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
    SELECT ?1, ?2, ?3, 'drap.pricing_changed', 'drap_pricing', ?4, ?5,
      MAX(?6, COALESCE((SELECT MAX(created_at) + 1 FROM platform_audit_events WHERE organization_id = ?2 AND action = 'drap.pricing_changed' AND entity_id = ?4), 0))
    WHERE (SELECT COUNT(*) FROM platform_audit_events WHERE organization_id = ?2 AND action = 'drap.pricing_changed' AND entity_id = ?4) = ?7`)
    .bind(crypto.randomUUID(), organizationId, actor, planId, JSON.stringify({ multiplierBps, revision: revision + 1 }), Date.now(), revision).run();
  if (!result.meta.changes) throw new ApiError(409, "pricing_conflict", "A política mudou em outro acesso. Atualize antes de salvar.");
  return pricingRule(organizationId, planId);
}

export async function lockedPricing(organizationId: string, requestKey: string) {
  const row = await getDatabase().prepare("SELECT metadata_json FROM platform_audit_events WHERE id = ?1 AND organization_id = ?2 AND action = 'drap.pricing_locked'")
    .bind(`drap-pricing:${requestKey}`, organizationId).first<{ metadata_json: string }>();
  if (!row) return null;
  const data = JSON.parse(row.metadata_json) as { planId: string; multiplierBps: number };
  drapPrice(0, data.multiplierBps);
  return data;
}

export async function lockPricing(organizationId: string, planId: string, requestKey: string) {
  const rule = await pricingRule(organizationId, planId);
  await getDatabase().prepare(`INSERT OR IGNORE INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?1, ?2, 'drap_activation', 'drap.pricing_locked', 'drap_pricing', ?3, ?4, ?5)`)
    .bind(`drap-pricing:${requestKey}`, organizationId, requestKey, JSON.stringify({ planId, multiplierBps: rule.multiplierBps }), Date.now()).run();
  const locked = (await lockedPricing(organizationId, requestKey))!;
  if (locked.planId !== planId) throw new ApiError(409, "pricing_plan_conflict", "Esta solicitação já foi vinculada a outro plano.");
  return locked;
}
