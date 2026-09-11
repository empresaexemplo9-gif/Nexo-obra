import { ApiError } from "@/lib/server/backend";

const encoder = new TextEncoder();

export function createInvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function invitationTokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function validateInvitationState(invitation: {
  accepted_at: number | null;
  revoked_at: number | null;
  expires_at: number;
}) {
  if (invitation.revoked_at) throw new ApiError(410, "invitation_revoked", "Este convite foi revogado.");
  if (invitation.accepted_at) throw new ApiError(409, "invitation_used", "Este convite já foi utilizado.");
  if (invitation.expires_at <= Date.now()) throw new ApiError(410, "invitation_expired", "Este convite expirou.");
}
