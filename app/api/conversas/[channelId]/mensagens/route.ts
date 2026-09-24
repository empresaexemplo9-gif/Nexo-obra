import { apiRoute, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { listMessages, messageSchema, postMessage } from "@/lib/server/chat";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ channelId: string }> };

const isoOrNull = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? value : null);

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { channelId } = await route.params;
    const search = new URL(request.url).searchParams;
    return Response.json(await listMessages(context, channelId, { since: isoOrNull(search.get("since")), before: isoOrNull(search.get("before")) }));
  });
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = messageSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const { channelId } = await route.params;
    const result = await postMessage(context, channelId, parsed.data);
    return Response.json({ message: result.message }, { status: result.created ? 201 : 200 });
  });
}
