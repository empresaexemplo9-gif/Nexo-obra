import { apiRoute, requireOrganizationContext } from "@/lib/server/backend";
import { deleteChannel } from "@/lib/server/chat";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ channelId: string }> };

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { channelId } = await route.params;
    await deleteChannel(context, channelId);
    return new Response(null, { status: 204 });
  });
}
