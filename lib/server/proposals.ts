import { ApiError } from "@/lib/server/api-error";
import { runtimeEnv } from "@/lib/server/runtime";
import {
  proposalContentSchema,
  type ProposalChannel,
  type ProposalContent,
  type ProposalStatus,
  validUntil,
} from "@/lib/proposals";

// Regras de servidor da proposta: link do cliente, leitura do banco e formato de resposta.
//
// ─── LINK DO CLIENTE ───
//
// O cliente não tem conta: a proposta chega por um link. O link é `id.assinatura`, com a
// assinatura feita por HMAC sobre o id e um `link_nonce` guardado na linha. Assim o link
// pode ser mostrado de novo para reenviar (não há segredo guardado em claro no banco), e
// trocar o nonce invalida o link antigo. Sem o segredo da sessão ninguém fabrica um link
// válido para outra proposta.

const encoder = new TextEncoder();

function proposalSecret() {
  const env = runtimeEnv();
  const secret = env.SESSION_SECRET ?? env.SUPERADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(503, "session_secret_missing", "O link da proposta depende de SESSION_SECRET, que não está configurado nesta instalação.");
  }
  return secret;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signature(id: string, nonce: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(proposalSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`proposta:${id}:${nonce}`)));
  return base64Url(mac).slice(0, 32);
}

export function newLinkNonce() {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function proposalToken(id: string, nonce: string) {
  return `${id}.${await signature(id, nonce)}`;
}

/** Separa o id do token sem confiar nele. A assinatura é conferida depois, com o nonce. */
export function tokenProposalId(token: string) {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(token);
  return match ? match[1] : null;
}

function sameText(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function tokenMatches(token: string, id: string, nonce: string) {
  return sameText(token, await proposalToken(id, nonce));
}

export function proposalLink(origin: string, token: string) {
  return `${origin}/proposta/${token}`;
}

// ─── LEITURA ───

export type ProposalRow = {
  id: string; organization_id: string; project_id: string | null; client_id: string | null; budget_version_id: string | null;
  code: string; title: string; recipient_name: string; recipient_email: string | null; recipient_phone: string | null;
  content_json: string; total_cents: number; validity_days: number; status: ProposalStatus; link_nonce: string;
  scheduled_at: number | null; scheduled_channel: ProposalChannel | null; issued_at: number | null;
  sent_at: number | null; sent_channel: ProposalChannel | null;
  first_viewed_at: number | null; last_viewed_at: number | null; view_count: number;
  accepted_at: number | null; accepted_name: string | null; accepted_document: string | null;
  notice_ack_at: number | null; created_by_name: string; created_at: number; updated_at: number;
  project_name: string | null; client_name: string | null;
};

export const proposalSelect = `SELECT pr.id, pr.organization_id, pr.project_id, pr.client_id, pr.budget_version_id, pr.code, pr.title,
  pr.recipient_name, pr.recipient_email, pr.recipient_phone, pr.content_json, pr.total_cents, pr.validity_days, pr.status,
  pr.link_nonce, pr.scheduled_at, pr.scheduled_channel, pr.issued_at, pr.sent_at, pr.sent_channel, pr.first_viewed_at,
  pr.last_viewed_at, pr.view_count, pr.accepted_at, pr.accepted_name, pr.accepted_document, pr.notice_ack_at,
  pr.created_by_name, pr.created_at, pr.updated_at, p.name AS project_name, c.name AS client_name
  FROM proposals pr
  LEFT JOIN projects p ON p.id = pr.project_id AND p.organization_id = pr.organization_id
  LEFT JOIN clients c ON c.id = pr.client_id AND c.organization_id = pr.organization_id`;

/** Conteúdo guardado é sempre revalidado: uma linha corrompida não vira tela quebrada. */
export function parseContent(json: string): ProposalContent {
  const parsed = proposalContentSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new ApiError(500, "proposal_content_invalid", "O conteúdo desta proposta está ilegível.");
  return parsed.data;
}

/** O que a tela da equipe recebe. O link só vai quando a proposta pode ser aberta. */
export async function proposalResponse(row: ProposalRow, origin: string, withContent = false) {
  const linkActive = row.status === "sent" || row.status === "accepted";
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    projectId: row.project_id,
    projectName: row.project_name,
    clientId: row.client_id,
    clientName: row.client_name,
    budgetVersionId: row.budget_version_id,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    recipientPhone: row.recipient_phone,
    totalCents: Number(row.total_cents),
    validityDays: Number(row.validity_days),
    scheduledAt: row.scheduled_at,
    scheduledChannel: row.scheduled_channel,
    issuedAt: row.issued_at,
    sentAt: row.sent_at,
    sentChannel: row.sent_channel,
    firstViewedAt: row.first_viewed_at,
    lastViewedAt: row.last_viewed_at,
    viewCount: Number(row.view_count),
    acceptedAt: row.accepted_at,
    acceptedName: row.accepted_name,
    acceptedDocument: row.accepted_document,
    unseenNotice: Boolean(
      (row.accepted_at && row.accepted_at > (row.notice_ack_at ?? 0)) ||
      (row.first_viewed_at && row.first_viewed_at > (row.notice_ack_at ?? 0)),
    ),
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    link: linkActive ? proposalLink(origin, await proposalToken(row.id, row.link_nonce)) : null,
    ...(withContent ? { content: parseContent(row.content_json) } : {}),
  };
}

export async function nextProposalCode(db: D1Database, organizationId: string) {
  const row = await db.prepare(
    "SELECT MAX(CAST(substr(code, 6) AS INTEGER)) AS last FROM proposals WHERE organization_id = ?1 AND code LIKE 'PROP-%'",
  ).bind(organizationId).first<{ last: number | null }>();
  return `PROP-${String((row?.last ?? 0) + 1).padStart(4, "0")}`;
}

// ─── LADO DO CLIENTE ───

export type PublicProposalRow = ProposalRow & { organization_name: string; timezone: string };

/**
 * Proposta aberta pelo link. Devolve null para link inválido, adulterado ou de proposta
 * que ainda não foi enviada — a página mostra a mesma mensagem nos três casos, para não
 * revelar se o id existe.
 */
export async function loadProposalByToken(db: D1Database, token: string) {
  const id = tokenProposalId(token);
  if (!id) return null;
  const row = await db.prepare(
    `${proposalSelect.replace("FROM proposals pr", ", o.name AS organization_name, o.timezone FROM proposals pr JOIN organizations o ON o.id = pr.organization_id")}
     WHERE pr.id = ?1`,
  ).bind(id).first<PublicProposalRow>();
  if (!row || !(await tokenMatches(token, row.id, row.link_nonce))) return null;
  if (row.status !== "sent" && row.status !== "accepted") return null;
  return row;
}

export function publicProposalView(row: PublicProposalRow, now = Date.now()) {
  const issuedAt = row.issued_at ?? row.sent_at ?? row.created_at;
  return {
    code: row.code,
    title: row.title,
    organizationName: row.organization_name,
    timezone: row.timezone,
    recipientName: row.recipient_name,
    projectName: row.project_name,
    issuedAt,
    validityDays: Number(row.validity_days),
    totalCents: Number(row.total_cents),
    content: parseContent(row.content_json),
    acceptedAt: row.accepted_at,
    acceptedName: row.accepted_name,
    updatedAfterSend: Boolean(row.sent_at && row.updated_at > row.sent_at + 1000),
    expired: row.status !== "accepted" && now > validUntil(issuedAt, Number(row.validity_days)),
  };
}

export type PublicProposalView = ReturnType<typeof publicProposalView>;
