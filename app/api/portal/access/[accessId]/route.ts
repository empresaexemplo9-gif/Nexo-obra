import { ensureFound, jsonBody } from "@/lib/server/backend";
import { acceptPortal, accessResponse, clientAccess, portalItems, portalJson } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ accessId: string }> };
export async function GET(request: Request, { params }: Params) {
  return portalRoute(async () => {
    const { db, access } = await clientAccess(request, (await params).accessId);
    const progress = access.view_progress ? ensureFound(await db.prepare("SELECT status, phase, progress_percent AS progressPercent, start_date AS startDate, target_date AS targetDate FROM projects WHERE id = ?1 AND organization_id = ?2")
      .bind(access.project_id, access.organization_id).first(), "Obra") : null;
    return portalJson({ access: accessResponse(access, true), progress, ...await portalItems(db, access.organization_id, access.id, new URL(request.url)) });
  });
}
export async function POST(request: Request, { params }: Params) {
  return portalRoute(async () => portalJson(await acceptPortal(request, (await params).accessId, null, await jsonBody(request))));
}
