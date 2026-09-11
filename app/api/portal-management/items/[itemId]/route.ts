import { jsonBody } from "@/lib/server/backend";
import { portalJson, portalManager, withdrawPortalItem } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  return portalRoute(async () => portalJson(await withdrawPortalItem(await portalManager(request, "edit"), (await params).itemId, await jsonBody(request))));
}
