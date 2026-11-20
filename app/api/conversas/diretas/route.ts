import { apiRoute, jsonBody, requireOrganizationContext, validationError, requireFerramenta } from "@/lib/server/backend";
import { directSchema, openDirect } from "@/lib/server/chat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireFerramenta(context, "comunicacao");
    const parsed = directSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    return Response.json({ channelId: await openDirect(context, parsed.data.memberId) });
  });
}
