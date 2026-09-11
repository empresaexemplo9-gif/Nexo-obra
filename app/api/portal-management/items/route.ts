import { jsonBody } from "@/lib/server/backend";
import { managerAccess, portalItems, portalJson, portalManager, publishPortalItem } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return portalRoute(async () => {
    const context = await portalManager(request);
    const url = new URL(request.url); const access = await managerAccess(context, url.searchParams.get("accessId") ?? "");
    return portalJson(await portalItems(context.db, context.organization.id, access.id, url, true));
  });
}
export async function POST(request: Request) {
  return portalRoute(async () => portalJson({ item: await publishPortalItem(await portalManager(request, "edit"), await jsonBody(request)) }, 201));
}
