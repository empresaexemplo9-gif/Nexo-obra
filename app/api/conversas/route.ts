import { apiRoute, jsonBody, requireOrganizationContext, validationError, requireFerramenta } from "@/lib/server/backend";
import { channelSchema, createChannel, listConversations } from "@/lib/server/chat";

export const dynamic = "force-dynamic";

// Toda pessoa da empresa usa a Comunicação: não há módulo de permissão para conversar.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireFerramenta(context, "comunicacao");
    return Response.json(await listConversations(context));
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireFerramenta(context, "comunicacao");
    const parsed = channelSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    return Response.json({ channelId: await createChannel(context, parsed.data.name) }, { status: 201 });
  });
}
