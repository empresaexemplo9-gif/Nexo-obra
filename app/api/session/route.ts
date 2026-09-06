import { z } from "zod";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

import {
  ApiError,
  apiRoute,
  authenticatedIdentity,
  jsonBody,
  listOrganizationMemberships,
  organizationSelectionCookie,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const selectOrganizationSchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request) {
  return apiRoute(async () => {
    try {
      const identity = authenticatedIdentity(request);
      const memberships = await listOrganizationMemberships(request);
      if (memberships.length === 0) {
        return Response.json({
          authenticated: true,
          needsOrganization: true,
          user: identity,
          organizations: [],
        });
      }

      const context = await requireOrganizationContext(request, undefined, { allowUnacceptedTerms: true });
      return Response.json({
        authenticated: true,
        needsOrganization: false,
        user: context.user,
        member: { id: context.member.id, role: context.member.role, permissions: context.member.permissions },
        terms: { version: CURRENT_TERMS_VERSION, accepted: context.termsAccepted },
        organization: context.organization,
        organizations: memberships.map((membership) => ({
          id: membership.organization_id,
          name: membership.organization_name,
          slug: membership.organization_slug,
          timezone: membership.timezone,
          role: membership.role,
        })),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return Response.json({
          authenticated: false,
          needsOrganization: false,
          signInPath: "/signin-with-chatgpt?return_to=%2F",
          organizations: [],
        });
      }
      throw error;
    }
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    authenticatedIdentity(request);
    const parsed = selectOrganizationSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const memberships = await listOrganizationMemberships(request);
    const selected = memberships.find(
      (membership) => membership.organization_id === parsed.data.organizationId,
    );
    if (!selected) {
      throw new ApiError(403, "organization_forbidden", "Você não participa desta empresa.");
    }

    return Response.json(
      {
        organization: {
          id: selected.organization_id,
          name: selected.organization_name,
          slug: selected.organization_slug,
          timezone: selected.timezone,
          role: selected.role,
        },
      },
      { headers: { "Set-Cookie": organizationSelectionCookie(selected.organization_id) } },
    );
  });
}
