import { clientAccess } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
import { portalPhoto } from "@/lib/server/portal-photo";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ accessId: string; itemId: string; photoId: string }> }) {
  return portalRoute(async () => {
    const { accessId, itemId, photoId } = await params;
    const { db, access } = await clientAccess(request, accessId);
    return portalPhoto(db, access.organization_id, access.id, itemId, photoId);
  });
}
