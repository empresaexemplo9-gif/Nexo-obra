import { jsonBody } from "@/lib/server/backend";
import { acceptPortal, accessResponse, portalInvitation, portalJson } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string }> };
export async function GET(request: Request, { params }: Params) {
  return portalRoute(async () => {
    const { access } = await portalInvitation(request, (await params).token);
    return portalJson({ access: accessResponse(access), termsVersion: CURRENT_TERMS_VERSION });
  });
}
export async function POST(request: Request, { params }: Params) {
  return portalRoute(async () => portalJson(await acceptPortal(request, null, (await params).token, await jsonBody(request))));
}
