import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { createPasswordReset } from "@/lib/server/password-reset";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ memberId: string }> };

// Gera o link de nova senha de um acesso desta empresa. As regras de quem pode gerar para
// quem ficam em lib/server/password-reset.ts.
export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "edit");
    const { memberId } = await route.params;
    const reset = await createPasswordReset(context, memberId);
    return Response.json({ resetPath: reset.path, expiresAt: reset.expiresAt, email: reset.email },
      { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}
