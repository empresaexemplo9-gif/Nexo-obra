import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { requireActiveDrapConnection } from "@/lib/server/drap";
import { probeDrapResources } from "@/lib/server/drap-resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const connection = await requireActiveDrapConnection(context);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    const resources = await probeDrapResources(connection.external_company_id, fresh);

    return Response.json({
      checkedAt: new Date().toISOString(),
      externalCompanyId: connection.external_company_id,
      resources,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
