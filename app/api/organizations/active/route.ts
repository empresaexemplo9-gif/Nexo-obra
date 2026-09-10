import { ACTIVE_ORGANIZATION_COOKIE, requireAuth } from "@/lib/auth/session";
import { switchOrganizationSchema } from "@/lib/domain/schemas";
import { apiError, handleRoute, parseJsonBody } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/**
 * Troca a empresa ativa.
 *
 * O corpo informa a empresa desejada, mas quem decide é o servidor: só grava o
 * cookie se `organizationId` estiver entre as associações reais do usuário.
 * Um ID de empresa alheia responde 403 e não muda nada.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const auth = await requireAuth();

    const body = await parseJsonBody(request, switchOrganizationSchema);
    if (!body.ok) return body.response;

    const membership = auth.memberships.find(
      (candidate) => candidate.organizationId === body.data.organizationId,
    );

    if (!membership) {
      return apiError(403, "forbidden", "Você não participa desta empresa.");
    }

    const response = Response.json({
      active: {
        organizationId: membership.organizationId,
        organizationName: membership.organizationName,
        role: membership.role,
      },
    });

    response.headers.append(
      "Set-Cookie",
      `${ACTIVE_ORGANIZATION_COOKIE}=${membership.organizationId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
    );

    return response;
  });
}
