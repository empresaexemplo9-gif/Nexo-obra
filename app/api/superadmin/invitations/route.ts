import { z } from "zod";

import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { createInvitationToken, invitationTokenHash } from "@/lib/server/invitations";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

const invitationSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().email().max(160),
  role: z.enum(["admin", "manager", "member"]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

type InvitationRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  role: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

const invitationSelect = `SELECT
  i.id, i.organization_id, o.name AS organization_name, i.email, i.role,
  i.expires_at, i.accepted_at, i.revoked_at, i.created_at
  FROM organization_invitations i
  INNER JOIN organizations o ON o.id = i.organization_id`;

function invitationResponse(invitation: InvitationRow) {
  const now = Date.now();
  const status = invitation.revoked_at ? "revoked"
    : invitation.accepted_at ? "accepted"
    : invitation.expires_at <= now ? "expired"
    : "pending";
  return {
    id: invitation.id,
    organizationId: invitation.organization_id,
    organizationName: invitation.organization_name,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expires_at,
    acceptedAt: invitation.accepted_at,
    createdAt: invitation.created_at,
    status,
  };
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const result = await getDatabase().prepare(`${invitationSelect} ORDER BY i.created_at DESC LIMIT 100`).all<InvitationRow>();
    return Response.json({ invitations: result.results.map(invitationResponse) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const parsed = invitationSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const db = getDatabase();
    const organization = await db.prepare("SELECT id, name FROM organizations WHERE id = ?1")
      .bind(parsed.data.organizationId).first<{ id: string; name: string }>();
    if (!organization) throw new ApiError(404, "organization_not_found", "Empresa não encontrada.");

    const email = parsed.data.email.toLowerCase();
    const pending = await db.prepare(
      `SELECT id FROM organization_invitations
       WHERE organization_id = ?1 AND lower(email) = ?2
         AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?3
       LIMIT 1`,
    ).bind(organization.id, email, Date.now()).first();
    if (pending) throw new ApiError(409, "pending_invitation_exists", "Já existe um convite válido para este e-mail nesta empresa.");

    const id = crypto.randomUUID();
    const token = createInvitationToken();
    const tokenHash = await invitationTokenHash(token);
    const createdAt = Date.now();
    const expiresAt = createdAt + parsed.data.expiresInDays * 24 * 60 * 60 * 1000;
    await db.prepare(
      `INSERT INTO organization_invitations (
        id, organization_id, email, role, token_hash, invited_by_email,
        expires_at, accepted_at, accepted_by_user_id, revoked_at, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, NULL, ?8)`,
    ).bind(id, organization.id, email, parsed.data.role, tokenHash, admin.email, expiresAt, createdAt).run();

    return Response.json({
      invitation: invitationResponse({
        id,
        organization_id: organization.id,
        organization_name: organization.name,
        email,
        role: parsed.data.role,
        expires_at: expiresAt,
        accepted_at: null,
        revoked_at: null,
        created_at: createdAt,
      }),
      invitationPath: `/convite/${token}`,
    }, { status: 201 });
  });
}
