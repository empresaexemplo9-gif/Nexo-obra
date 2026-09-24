import { apiRoute, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { criarLayout, criarSchema, listarLayouts } from "@/lib/server/layouts";

export const dynamic = "force-dynamic";

// O criador de layout segue a permissão "Prancheta e projeto".
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "view");
    return Response.json({ layouts: await listarLayouts(context) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");
    const parsed = criarSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    return Response.json({ layout: await criarLayout(context, parsed.data) }, { status: 201 });
  });
}
