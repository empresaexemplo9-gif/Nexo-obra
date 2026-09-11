import { jsonBody } from "@/lib/server/backend";
import { changePortalAccess, portalJson, portalManager } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ accessId: string }> }) {
  return portalRoute(async () => portalJson(await changePortalAccess(await portalManager(request, "edit", true), (await params).accessId, await jsonBody(request))));
}
