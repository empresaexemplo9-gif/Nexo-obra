import { z } from "zod";
import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { pricingCatalog } from "@/lib/server/drap-pricing";

const schema = z.object({ itemIds: z.array(z.string().min(1).max(120)).max(16) }).strict();
export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const ids = [...new Set(parsed.data.itemIds)];
    const catalog = await pricingCatalog(context.organization.id);
    const items = ids.map(id => catalog.find(item => item.id === id));
    if (items.some(item => !item || item.kind === "free")) throw new ApiError(400, "invalid_selection", "Selecione os módulos ou pacotes disponíveis.");
    const selected = items.filter(item => item !== undefined);
    // Salvar interesse não contrata nem lança uma cobrança. A Drap confirma ambos.
    await auditStatement(context, "drap.selection_saved", "drap_selection", context.organization.id, { itemIds: ids, offers: selected.map(item => ({ id: item.id, monthlyCents: item.monthlyCents })), status: "awaiting_provider_checkout" }).run();
    return Response.json({ saved: true, contracted: false, itemIds: ids }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
