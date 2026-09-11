import { jsonBody } from "@/lib/server/backend";
import { decidePortalItem, portalJson } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ accessId: string; itemId: string }> }) {
  return portalRoute(async () => {
    const { accessId, itemId } = await params;
    return portalJson(await decidePortalItem(request, accessId, itemId, await jsonBody(request)));
  });
}
