import { apiRoute, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { channelSchema, createChannel, listConversations } from "@/lib/server/chat";

export const dynamic = "force-dynamic";

// Toda pessoa da empresa usa a Comunicação: não há módulo de permissão para conversar.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    return Response.json(await listConversations(context));
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = channelSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    return Response.json({ channelId: await createChannel(context, parsed.data.name) }, { status: 201 });
  });
}
