import { getAuthState } from "@/lib/auth/session";
import { handleRoute } from "@/lib/server/api";

export const dynamic = "force-dynamic";

/**
 * Estado da sessão para a interface.
 *
 * Devolve identidade, empresas do usuário e a empresa ativa — nada de token e
 * nada que o cliente possa usar para escolher a empresa por conta própria: a
 * troca passa por `POST /api/organizations/active`, que reconfere o vínculo.
 */
export async function GET() {
  return handleRoute(async () => {
    const state = await getAuthState();

    if (state.status === "anonymous") {
      return Response.json({ status: "anonymous" as const });
    }

    const user = {
      email: state.identity.email,
      displayName: state.identity.displayName,
      provider: state.identity.provider,
    };

    if (state.status !== "authenticated") {
      return Response.json({ status: state.status, user });
    }

    return Response.json({
      status: "authenticated" as const,
      user,
      memberships: state.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        organizationName: membership.organizationName,
        organizationSlug: membership.organizationSlug,
        role: membership.role,
      })),
      active: {
        organizationId: state.active.organizationId,
        organizationName: state.active.organizationName,
        role: state.active.role,
        memberId: state.active.memberId,
      },
    });
  });
}
