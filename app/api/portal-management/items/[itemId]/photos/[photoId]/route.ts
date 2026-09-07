import { managerAccess, portalManager } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
import { portalPhoto } from "@/lib/server/portal-photo";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ itemId: string; photoId: string }> }) {
  return portalRoute(async () => {
    const context = await portalManager(request); const access = await managerAccess(context, new URL(request.url).searchParams.get("accessId") ?? "");
    const { itemId, photoId } = await params;
    return portalPhoto(context.db, context.organization.id, access.id, itemId, photoId, true);
  });
}
