import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  canManageOrganizationAccess,
  jsonBody,
  requireModulePermission,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";
import { createInvitationToken, invitationTokenHash } from "@/lib/server/invitations";
import { normalizePermissions, parseStoredPermissions, permissionModules } from "@/lib/permissions";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const invitationSchema = z.object({
  email: z.string().trim().email().max(160),
  role: z.enum(["admin", "manager", "member", "partner", "service_provider", "finance", "accounting"]),
  permissions: z.record(z.string(), z.object({ view: z.boolean(), edit: z.boolean() })),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  permissions_json: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

function response(row: InvitationRow) {
  const status = row.revoked_at ? "revoked" : row.accepted_at ? "accepted" : row.expires_at <= Date.now() ? "expired" : "pending";
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    permissions: parseStoredPermissions(row.permissions_json, row.role),
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    status,
  };
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "view");
    const result = await context.db.prepare(
      `SELECT id, email, role, permissions_json, expires_at, accepted_at, revoked_at, created_at
       FROM organization_invitations WHERE organization_id = ?1
       ORDER BY created_at DESC LIMIT 100`,
    ).bind(context.organization.id).all<InvitationRow>();
    return Response.json({ invitations: result.results.map(response) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "team", "edit");
    if (!canManageOrganizationAccess(context)) {
      throw new ApiError(403, "access_management_denied", "Somente o contratante ou um administrador autorizado pode criar acessos.");
    }
    const parsed = invitationSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const email = parsed.data.email.toLowerCase();
    const permissions = normalizePermissions(parsed.data.permissions, parsed.data.role);
    if (!permissionModules.some((module) => permissions[module].view)) {
      throw new ApiError(400, "empty_permissions", "Marque ao menos uma área como visível.");
    }
    const pending = await context.db.prepare(
      `SELECT id FROM organization_invitations
       WHERE organization_id = ?1 AND lower(email) = ?2
         AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?3 LIMIT 1`,
    ).bind(context.organization.id, email, Date.now()).first();
    if (pending) throw new ApiError(409, "pending_invitation_exists", "Já existe um convite válido para este e-mail.");

    const id = crypto.randomUUID();
    const token = createInvitationToken();
    const tokenHash = await invitationTokenHash(token);
    const createdAt = Date.now();
    const expiresAt = createdAt + parsed.data.expiresInDays * 86_400_000;
    const row: InvitationRow = {
      id, email, role: parsed.data.role, permissions_json: JSON.stringify(permissions),
      expires_at: expiresAt, accepted_at: null, revoked_at: null, created_at: createdAt,
    };
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO organization_invitations (
          id, organization_id, email, role, permissions_json, token_hash, invited_by_email,
          expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9)`,
      ).bind(id, context.organization.id, email, parsed.data.role, row.permissions_json, tokenHash, context.user.email, expiresAt, createdAt),
      auditStatement(context, "invitation.created", "invitation", id, { email, role: parsed.data.role }),
    ]);
    return Response.json({ invitation: response(row), invitationPath: `/convite/${token}` }, { status: 201 });
  });
}
