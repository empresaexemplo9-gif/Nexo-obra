import { apiRoute, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { abrirLayout, excluirLayout, salvarLayout, salvarSchema } from "@/lib/server/layouts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ layoutId: string }> };

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "view");
    const { layoutId } = await route.params;
    return Response.json({ layout: await abrirLayout(context, layoutId) });
  });
}

export async function PUT(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");
    const parsed = salvarSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const { layoutId } = await route.params;
    return Response.json({ layout: await salvarLayout(context, layoutId, parsed.data) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");
    const { layoutId } = await route.params;
    await excluirLayout(context, layoutId);
    return new Response(null, { status: 204 });
  });
}
