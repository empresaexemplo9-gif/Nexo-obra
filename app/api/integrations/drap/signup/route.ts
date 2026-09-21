import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { drapCatalogItem } from "@/lib/integrations/drap-catalog";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const DRAP_SIGNUP_URL = "https://empresa.drap.app.br/signup";
const signupSchema = z.object({
  catalogItemId: z.string().trim().min(1).max(80).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");

    const parsed = signupSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const catalogItemId = parsed.data.catalogItemId ?? null;
    if (catalogItemId && !drapCatalogItem(catalogItemId)) {
      throw new ApiError(400, "invalid_drap_catalog_item", "A solução DRAP selecionada não existe no catálogo atual.");
    }

    await auditStatement(
      context,
      "integration.drap_signup_started",
      "drap_signup",
      catalogItemId ?? "account",
      { catalogItemId, destination: "empresa.drap.app.br/signup" },
    ).run();

    return Response.json(
      { redirectUrl: DRAP_SIGNUP_URL, catalogItemId },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
