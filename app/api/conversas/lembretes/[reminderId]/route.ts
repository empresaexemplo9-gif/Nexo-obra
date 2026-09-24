import { z } from "zod";

import { apiRoute, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { setReminderDone } from "@/lib/server/chat";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ reminderId: string }> };
const schema = z.object({ done: z.boolean() }).strict();

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const { reminderId } = await route.params;
    await setReminderDone(context, reminderId, parsed.data.done);
    return new Response(null, { status: 204 });
  });
}
