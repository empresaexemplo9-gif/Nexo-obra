import { getDatabase } from "@/db";
import { ApiError, apiRoute } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { logotipoDaEmpresa } from "@/lib/server/empresa-config";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ organizationId: string }> };

/** Logotipo de qualquer empresa, para a prévia no painel do superadministrador. */
export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const { organizationId } = await route.params;
    const logo = await logotipoDaEmpresa(getDatabase(), organizationId);
    if (!logo) throw new ApiError(404, "logo_not_found", "Esta empresa ainda não tem logotipo.");
    return new Response(Uint8Array.from(atob(logo.logo_base64), (c) => c.charCodeAt(0)), {
      headers: {
        "Content-Type": logo.logo_mime, "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
