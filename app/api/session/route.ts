import { ApiError, apiRoute, requireOrganizationContext } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    try {
      const context = await requireOrganizationContext(request);
      return Response.json({
        authenticated: true,
        user: context.user,
        member: { id: context.member.id, role: context.member.role },
        organization: context.organization,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return Response.json({
          authenticated: false,
          signInPath: "/signin-with-chatgpt?return_to=%2F",
        });
      }
      throw error;
    }
  });
}
