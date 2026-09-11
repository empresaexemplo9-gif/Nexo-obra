import { ApiError } from "@/lib/server/backend";
import { portalAccessesForUser, portalJson } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return portalRoute(async () => {
    try {
      const { accesses, identity } = await portalAccessesForUser(request);
      return portalJson({ authenticated: true, accesses, userName: identity.displayName, termsVersion: CURRENT_TERMS_VERSION });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return portalJson({ authenticated: false, accesses: [], termsVersion: CURRENT_TERMS_VERSION });
      throw error;
    }
  });
}
