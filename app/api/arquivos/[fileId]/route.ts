import { apiRoute, requireOrganizationContext } from "@/lib/server/backend";
import { fileResponse, removeFromLibrary, requireReadableFile } from "@/lib/server/org-files";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string }> };

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { fileId } = await route.params;
    return Response.json({ file: fileResponse(await requireReadableFile(context, fileId)) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { fileId } = await route.params;
    await removeFromLibrary(context, fileId);
    return new Response(null, { status: 204 });
  });
}
