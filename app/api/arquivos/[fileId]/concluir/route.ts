import { z } from "zod";

import { apiRoute, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { completeUpload, fileResponse } from "@/lib/server/org-files";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string }> };
const schema = z.object({ area: z.enum(["prancheta", "conversa"]) }).strict();

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const { fileId } = await route.params;
    return Response.json({ file: fileResponse(await completeUpload(context, fileId, parsed.data.area)) });
  });
}
