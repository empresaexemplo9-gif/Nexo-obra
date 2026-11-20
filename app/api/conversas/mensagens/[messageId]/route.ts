import { apiRoute, jsonBody, requireOrganizationContext, validationError, requireFerramenta } from "@/lib/server/backend";
import { deleteMessage, editMessage, editSchema } from "@/lib/server/chat";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ messageId: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireFerramenta(context, "comunicacao");
    const parsed = editSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const { messageId } = await route.params;
    await editMessage(context, messageId, parsed.data.body);
    return new Response(null, { status: 204 });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireFerramenta(context, "comunicacao");
    const { messageId } = await route.params;
    await deleteMessage(context, messageId);
    return new Response(null, { status: 204 });
  });
}
