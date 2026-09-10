import { z } from "zod";

import {
  ApiError,
  apiRoute,
  canManageOrganizationAccess,
  isPlatformSuperAdmin,
  jsonBody,
  requireOrganizationContext,
  validationError,
  type OrganizationContext,
} from "@/lib/server/backend";
import { clientAccess } from "@/lib/server/portal";
import {
  closeStaleUsageSessions,
  parseUsageRange,
  recordUsageHeartbeat,
  usageDayKey,
  usageReport,
  USAGE_BEAT_MS,
  type UsageSubject,
} from "@/lib/server/usage";

export const dynamic = "force-dynamic";

const heartbeatSchema = z.object({ accessId: z.string().uuid().optional() }).strict();

function subjectFromContext(context: OrganizationContext): UsageSubject {
  return {
    organizationId: context.organization.id,
    subjectId: context.member.externalUserId,
    subjectKind: context.member.role === "superadmin" ? "superadmin"
      : context.member.externalUserId === "nexo-maintenance-admin" ? "maintenance" : "member",
    email: context.user.email,
    displayName: context.user.displayName,
    role: context.member.role,
    memberId: context.member.id,
    timeZone: context.organization.timezone,
  };
}

// Todo acesso conta: contratante, equipe, parceiro, prestador, manutenção, superadmin e
// cliente do portal. O corpo só informa qual portal está aberto; identidade e empresa
// continuam sendo resolvidas no servidor.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const parsed = heartbeatSchema.safeParse((await jsonBody(request).catch(() => ({}))) ?? {});
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);

    if (parsed.data.accessId) {
      const { db, access, identity } = await clientAccess(request, parsed.data.accessId);
      const result = await recordUsageHeartbeat(db, {
        organizationId: access.organization_id,
        subjectId: identity.id,
        subjectKind: "portal_client",
        email: identity.email,
        displayName: identity.displayName,
        role: "client",
        memberId: null,
        timeZone: "America/Sao_Paulo",
      });
      return Response.json({ ...result, beatMs: USAGE_BEAT_MS }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const context = await requireOrganizationContext(request, undefined, { allowUnacceptedTerms: true });
    const result = await recordUsageHeartbeat(context.db, subjectFromContext(context));
    return Response.json({ ...result, beatMs: USAGE_BEAT_MS }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

// Quem vê o quê: cada acesso vê o próprio histórico; o contratante e o administrador
// veem toda a empresa em que estão; o superadministrador vê qualquer empresa e todos.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, undefined, { allowUnacceptedTerms: true });
    const url = new URL(request.url);
    const range = parseUsageRange(url, context.organization.timezone);
    const platform = isPlatformSuperAdmin(context);
    const wholeCompany = platform || canManageOrganizationAccess(context);
    const requestedOrganization = url.searchParams.get("organizationId");
    const requestedSubject = url.searchParams.get("subjectId");

    if (requestedOrganization && requestedOrganization !== context.organization.id && !platform) {
      throw new ApiError(403, "usage_scope_denied", "Você só acompanha o uso da empresa aberta.");
    }
    if (requestedSubject && requestedSubject !== context.member.externalUserId && !wholeCompany) {
      throw new ApiError(403, "usage_scope_denied", "Seu acesso mostra apenas o seu próprio histórico.");
    }

    await closeStaleUsageSessions(context.db).run();
    const report = await usageReport(context.db, {
      ...range,
      timeZone: context.organization.timezone,
      organizationId: platform ? requestedOrganization ?? undefined : context.organization.id,
      subjectId: wholeCompany ? requestedSubject ?? undefined : context.member.externalUserId,
    });

    return Response.json({
      ...report,
      today: usageDayKey(Date.now(), context.organization.timezone),
      scope: platform ? "platform" : wholeCompany ? "organization" : "self",
      viewer: { subjectId: context.member.externalUserId, role: context.member.role, displayName: context.user.displayName },
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
