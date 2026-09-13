import { apiRoute } from "@/lib/server/backend";
import { authorizeSinapiCron, monthlySinapi, withSinapiLock } from "@/lib/server/sinapi-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  return apiRoute(async () => {
    authorizeSinapiCron(request);
    await withSinapiLock((token) => monthlySinapi(token));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
