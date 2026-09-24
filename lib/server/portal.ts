import { z } from "zod";
import { getDatabase } from "@/db";
import { assertPlatformAccess } from "@/lib/server/platform-access";
import { ApiError, apiRoute, authenticatedIdentity, requireModulePermission, requireOrganizationContext, canManageOrganizationAccess, ensureFound, validationError, auditStatement, type OrganizationContext } from "@/lib/server/backend";
import { createInvitationToken, invitationTokenHash } from "@/lib/server/invitations";
import { requestEvidenceHashes } from "@/lib/server/terms";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { PORTAL_PAGE_SIZE, portalAccessSchema, portalAccessChangeSchema, portalPublishSchema, portalDecisionSchema, type PortalAccess, type PortalItem } from "@/lib/portal";
import { privateHeaders, diaryEntry } from "@/lib/server/diary";

export const portalHeaders = { ...privateHeaders, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
export const portalJson = (data: unknown, status = 200) => Response.json(data, { status, headers: portalHeaders });
export async function portalRoute(action: () => Promise<Response>) {
  const response = await apiRoute(action);
  for (const [key, value] of Object.entries(portalHeaders)) response.headers.set(key, value);
  return response;
}
// O link do convite é um caminho; a tela completa com o próprio endereço. Antes ele saía
// sempre com um domínio fixo, e em domínio próprio ou prévia o cliente ia parar em outro site.
const invitationPath = (token: string) => `/portal/convite/${token}`;
export function checkPortalOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new ApiError(403, "invalid_origin", "Origem não permitida.");
}
export async function portalManager(request: Request, action: "view" | "edit" = "view", manageAccess = false) {
  const context = await requireOrganizationContext(request);
  requireModulePermission(context, "portal", action);
  if (action === "edit") checkPortalOrigin(request);
  if (manageAccess && !canManageOrganizationAccess(context)) throw new ApiError(403, "portal_admin_required", "Somente o administrador autorizado pode gerenciar acessos de clientes.");
  return context;
}
export function portalId(value: string) {
  if (!z.string().uuid().safeParse(value).success) throw new ApiError(404, "not_found", "Registro não encontrado.");
  return value;
}
export type AccessRow = {
  id: string; organization_id: string; project_id: string; project_name: string; project_code: string; organization_name: string;
  name: string; email: string; external_user_id: string | null; token_hash: string; expires_at: number; status: PortalAccess["status"];
  view_progress: number; can_approve: number; revision: number; created_by_member_id: string;
};
const accessSelect = `SELECT a.*, p.name AS project_name, p.code AS project_code, o.name AS organization_name
 FROM client_portal_access a JOIN projects p ON p.id = a.project_id AND p.organization_id = a.organization_id JOIN organizations o ON o.id = a.organization_id`;
export function accessResponse(row: AccessRow, termsAccepted = false): PortalAccess {
  return { id: row.id, projectId: row.project_id, projectName: row.project_name, projectCode: row.project_code, organizationName: row.organization_name,
    name: row.name, email: row.email, status: row.status, viewProgress: row.view_progress === 1, canApprove: row.can_approve === 1, revision: row.revision, expiresAt: row.expires_at, termsAccepted };
}
export async function managerAccess(context: OrganizationContext, id: string) {
  return ensureFound(await context.db.prepare(`${accessSelect} WHERE a.id = ?1 AND a.organization_id = ?2`).bind(portalId(id), context.organization.id).first<AccessRow>(), "Acesso");
}
export async function portalIdentity(request: Request) {
  const identity = await authenticatedIdentity(request);
  if (identity.scope === "maintenance") throw new ApiError(403, "maintenance_scope", "A manutenção não pode assumir a identidade de um cliente. Use os controles internos do portal.");
  if (identity.scope === "superadmin") throw new ApiError(403, "superadmin_scope", "O superadministrador não assume a identidade de um cliente. Abra a empresa e use o portal do cliente por lá.");
  return identity;
}
export async function clientAccess(request: Request, id: string, allowUnaccepted = false) {
  const identity = await portalIdentity(request);
  const db = getDatabase();
  const access = ensureFound(await db.prepare(`${accessSelect} WHERE a.id = ?1 AND a.external_user_id = ?2 AND a.status = 'active'`)
    .bind(portalId(id), identity.id).first<AccessRow>(), "Acesso");
  await assertPlatformAccess(access.organization_id, identity.email, identity.id);
  const accepted = await db.prepare("SELECT id FROM client_portal_acceptances WHERE organization_id = ?1 AND access_id = ?2 AND external_user_id = ?3 AND terms_version = ?4")
    .bind(access.organization_id, access.id, identity.id, CURRENT_TERMS_VERSION).first();
  if (!accepted && !allowUnaccepted) throw new ApiError(403, "portal_terms_required", "Aceite os termos vigentes para abrir este portal.");
  return { db, access, identity, termsAccepted: Boolean(accepted) };
}
export async function portalAccessesForUser(request: Request) {
  const identity = await portalIdentity(request);
  const db = getDatabase();
  const rows = await db.prepare(`${accessSelect} WHERE a.external_user_id = ?1 AND a.status = 'active' ORDER BY o.name, p.name, a.id`).bind(identity.id).all<AccessRow>();
  const acceptances = await db.prepare("SELECT access_id FROM client_portal_acceptances WHERE external_user_id = ?1 AND terms_version = ?2")
    .bind(identity.id, CURRENT_TERMS_VERSION).all<{ access_id: string }>();
  const visible: AccessRow[] = [];
  for (const row of rows.results) {
    try { await assertPlatformAccess(row.organization_id, identity.email, identity.id); visible.push(row); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 403) throw error; }
  }
  return { identity, accesses: visible.map((row) => accessResponse(row, acceptances.results.some((item) => item.access_id === row.id))) };
}
export async function createPortalAccess(context: OrganizationContext, body: unknown) {
  const parsed = portalAccessSchema.safeParse(body);
  if (!parsed.success) throw validationError(parsed.error.flatten());
  const data = parsed.data;
  requireModulePermission(context, "projects", "view");
  ensureFound(await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2").bind(data.projectId, context.organization.id).first(), "Obra");
  const token = createInvitationToken(); const hash = await invitationTokenHash(token); const id = crypto.randomUUID();
  try {
    await context.db.batch([
      context.db.prepare(`INSERT INTO client_portal_access (id, organization_id, project_id, name, email, token_hash, expires_at, view_progress, can_approve, created_by_member_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
        .bind(id, context.organization.id, data.projectId, data.name, data.email, hash, Date.now() + 7 * 86400000, Number(data.viewProgress), Number(data.canApprove), context.member.id),
      auditStatement(context, "portal.access_invited", "client_portal_access", id, { projectId: data.projectId }),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "portal_access_exists", "Este e-mail já possui um acesso nesta obra. Use Renovar convite no acesso existente.");
    throw error;
  }
  return { access: accessResponse(await managerAccess(context, id)), invitationUrl: invitationPath(token) };
}
function conditionalAudit(context: OrganizationContext, action: string, type: string, id: string, metadata: object = {}) {
  return context.db.prepare(`INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE changes() > 0`)
    .bind(crypto.randomUUID(), context.organization.id, context.member.externalUserId, action, type, id, JSON.stringify(metadata), Date.now());
}
export async function changePortalAccess(context: OrganizationContext, id: string, body: unknown) {
  const current = await managerAccess(context, id);
  const parsed = portalAccessChangeSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error.flatten());
  const data = parsed.data;
  if (data.revision !== current.revision) throw new ApiError(409, "portal_access_conflict", "Este acesso mudou. Atualize a lista antes de tentar novamente.");
  const token = data.action === "renew" ? createInvitationToken() : null;
  const hash = token ? await invitationTokenHash(token) : current.token_hash;
  const status = data.action === "revoke" ? "revoked" : data.action === "renew" ? "pending" : current.status;
  const [updated] = await context.db.batch([
    context.db.prepare(`UPDATE client_portal_access SET status = ?1, token_hash = ?2, expires_at = ?3, external_user_id = ?4,
      view_progress = ?5, can_approve = ?6, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?7 AND organization_id = ?8 AND revision = ?9 RETURNING id`)
      .bind(status, hash, token ? Date.now() + 7 * 86400000 : current.expires_at, token ? null : current.external_user_id,
        data.action === "permissions" ? Number(data.viewProgress) : current.view_progress, data.action === "permissions" ? Number(data.canApprove) : current.can_approve, id, context.organization.id, data.revision),
    conditionalAudit(context, `portal.access_${data.action}`, "client_portal_access", id),
  ]);
  if (!updated.results.length) throw new ApiError(409, "portal_access_conflict", "Este acesso mudou. Atualize a lista antes de tentar novamente.");
  return { access: accessResponse(await managerAccess(context, id)), invitationUrl: token ? invitationPath(token) : null };
}
export async function portalInvitation(request: Request, token: string) {
  const identity = await portalIdentity(request);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(404, "not_found", "Convite não encontrado.");
  const db = getDatabase();
  const access = ensureFound(await db.prepare(`${accessSelect} WHERE a.token_hash = ?1`).bind(await invitationTokenHash(token)).first<AccessRow>(), "Convite");
  await assertPlatformAccess(access.organization_id, identity.email, identity.id);
  if (access.email !== identity.email.trim().toLowerCase()) throw new ApiError(403, "portal_invitation_email_mismatch", "Entre com o mesmo e-mail que recebeu este convite.");
  if (access.status === "revoked") throw new ApiError(410, "portal_invitation_revoked", "Este convite foi revogado.");
  if (access.status === "pending" && access.expires_at <= Date.now()) throw new ApiError(410, "portal_invitation_expired", "Este convite expirou. Solicite um novo à empresa.");
  if (access.status === "active" && access.external_user_id !== identity.id) throw new ApiError(409, "portal_invitation_used", "Este convite já foi utilizado por outra identidade.");
  return { db, access, identity };
}
export async function acceptPortal(request: Request, accessId: string | null, token: string | null, body: unknown) {
  checkPortalOrigin(request);
  if (!z.object({ accepted: z.literal(true), version: z.literal(CURRENT_TERMS_VERSION) }).strict().safeParse(body).success) throw new ApiError(400, "portal_terms_required", "Confirme o aceite da versão vigente dos termos.");
  const context = token ? await portalInvitation(request, token) : await clientAccess(request, accessId!, true);
  const { db, access, identity } = context;
  const evidence = await requestEvidenceHashes(request);
  const statements: D1PreparedStatement[] = [];
  if (token && access.status === "pending") statements.push(db.prepare(`UPDATE client_portal_access SET external_user_id = ?1, status = 'active', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?2 AND organization_id = ?3 AND status = 'pending' AND revision = ?4 AND token_hash = ?5 AND expires_at > ?6`)
    .bind(identity.id, access.id, access.organization_id, access.revision, access.token_hash, Date.now()));
  statements.push(db.prepare(`INSERT INTO client_portal_acceptances (id, organization_id, access_id, external_user_id, terms_version, ip_hash, user_agent_hash, accepted_at)
    SELECT ?1, organization_id, id, ?2, ?3, ?4, ?5, ?6 FROM client_portal_access WHERE id = ?7 AND organization_id = ?8 AND external_user_id = ?2 AND status = 'active'
    ON CONFLICT(access_id, external_user_id, terms_version) DO UPDATE SET accepted_at = client_portal_acceptances.accepted_at
    RETURNING id`).bind(crypto.randomUUID(), identity.id, CURRENT_TERMS_VERSION, evidence.ipHash, evidence.userAgentHash, Date.now(), access.id, access.organization_id));
  const results = await db.batch(statements);
  if (!results.at(-1)!.results.length) throw new ApiError(409, "portal_invitation_changed", "Este acesso mudou. Atualize o convite.");
  return { accepted: true, accessId: access.id };
}

type ItemRow = {
  id: string; organization_id: string; project_id: string; access_id: string; kind: PortalItem["kind"]; title: string; body: string;
  due_date: string | null; status: PortalItem["status"]; source_diary_id: string | null; source_diary_revision: number | null;
  photo_ids_json: string; author_name: string; withdrawal_reason: string; withdrawn_by_name: string; created_at: string; updated_at: string;
  decision_id: string | null; choice: "approved" | "changes_requested" | null; comment: string | null; actor_name: string | null; decided_at: string | null;
};
const itemSelect = `SELECT i.*, d.id AS decision_id, d.choice, d.comment, d.actor_name, d.created_at AS decided_at FROM client_portal_items i
 LEFT JOIN client_portal_decisions d ON d.item_id = i.id AND d.organization_id = i.organization_id AND d.access_id = i.access_id`;
export async function portalItem(db: D1Database, orgId: string, accessId: string, id: string) {
  return ensureFound(await db.prepare(`${itemSelect} WHERE i.id = ?1 AND i.organization_id = ?2 AND i.access_id = ?3`)
    .bind(portalId(id), orgId, accessId).first<ItemRow>(), "Solicitação");
}
export async function itemResponse(db: D1Database, row: ItemRow, admin = false): Promise<PortalItem> {
  const selected: string[] = JSON.parse(row.photo_ids_json);
  const photos = selected.length && (row.status !== "withdrawn" || admin) ? await db.prepare(`SELECT id, name, caption FROM diary_photos
    WHERE organization_id = ?1 AND entry_id = ?2 AND id IN (${selected.map((_, index) => `?${index + 3}`).join(",")}) ORDER BY slot`)
    .bind(row.organization_id, row.source_diary_id, ...selected).all<{ id: string; name: string; caption: string }>() : { results: [] };
  return { id: row.id, accessId: row.access_id, projectId: row.project_id, kind: row.kind, title: row.title, body: row.status === "withdrawn" && !admin ? "" : row.body,
    dueDate: row.due_date, status: row.status, authorName: row.author_name, createdAt: row.created_at, updatedAt: row.updated_at,
    withdrawalReason: row.withdrawal_reason, withdrawnByName: row.withdrawn_by_name,
    photos: photos.results.map((photo) => ({ ...photo, url: admin ? `/api/portal-management/items/${row.id}/photos/${photo.id}?accessId=${row.access_id}` : `/api/portal/access/${row.access_id}/items/${row.id}/photos/${photo.id}` })),
    decision: row.decision_id ? { id: row.decision_id, choice: row.choice!, comment: row.comment!, actorName: row.actor_name!, createdAt: row.decided_at! } : null };
}
export async function portalItems(db: D1Database, orgId: string, accessId: string, url: URL, admin = false) {
  const parsed = z.coerce.number().int().min(1).max(100000).safeParse(url.searchParams.get("page") ?? "1");
  if (!parsed.success) throw new ApiError(400, "invalid_page", "Página inválida.");
  const page = parsed.data;
  const [count, rows] = await db.batch([
    db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN kind = 'approval' AND status = 'open' THEN 1 ELSE 0 END), 0) AS pending FROM client_portal_items WHERE organization_id = ?1 AND access_id = ?2").bind(orgId, accessId),
    db.prepare(`${itemSelect} WHERE i.organization_id = ?1 AND i.access_id = ?2 ORDER BY CASE WHEN i.kind = 'approval' AND i.status = 'open' THEN 0 ELSE 1 END, i.created_at DESC, i.id DESC LIMIT ?3 OFFSET ?4`)
      .bind(orgId, accessId, PORTAL_PAGE_SIZE, (page - 1) * PORTAL_PAGE_SIZE),
  ]);
  const items = await Promise.all((rows.results as ItemRow[]).map((row) => itemResponse(db, row, admin)));
  return { ...count.results[0] as { total: number; pending: number }, items, page, pageSize: PORTAL_PAGE_SIZE };
}
export async function publishPortalItem(context: OrganizationContext, body: unknown) {
  const parsed = portalPublishSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error.flatten());
  const data = parsed.data;
  const access = await managerAccess(context, data.accessId);
  if (access.status === "revoked") throw new ApiError(409, "portal_access_revoked", "Renove o acesso antes de compartilhar novos itens.");
  if (data.kind === "approval" && !access.can_approve) throw new ApiError(409, "portal_approval_not_allowed", "Habilite a permissão de aprovação deste cliente antes de solicitar uma decisão.");
  let diaryRevision: number | null = null;
  if (data.sourceDiaryId) {
    requireModulePermission(context, "diary", "view");
    const diary = await diaryEntry(context, data.sourceDiaryId);
    if (diary.project_id !== access.project_id) throw new ApiError(400, "invalid_diary_project", "O diário não pertence à obra deste acesso.");
    diaryRevision = diary.revision;
    if (data.photoIds.length) {
      const photos = await context.db.prepare(`SELECT id FROM diary_photos WHERE organization_id = ?1 AND entry_id = ?2 AND id IN (${data.photoIds.map((_, index) => `?${index + 3}`).join(",")})`)
        .bind(context.organization.id, data.sourceDiaryId, ...data.photoIds).all();
      if (photos.results.length !== data.photoIds.length) throw new ApiError(400, "invalid_portal_photos", "Uma foto selecionada não pertence ao diário desta obra.");
    }
  }
  try {
    const [inserted] = await context.db.batch([
      context.db.prepare(`INSERT INTO client_portal_items (id, organization_id, project_id, access_id, kind, title, body, due_date, source_diary_id, source_diary_revision, photo_ids_json, created_by_member_id, author_name)
        SELECT ?1, organization_id, project_id, id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 FROM client_portal_access WHERE id = ?11 AND organization_id = ?12 AND status <> 'revoked' AND revision = ?13 RETURNING id`)
        .bind(data.id, data.kind, data.title, data.body, data.dueDate, data.sourceDiaryId, diaryRevision, JSON.stringify(data.photoIds), context.member.id, context.user.displayName, access.id, context.organization.id, access.revision),
      conditionalAudit(context, "portal.item_published", "client_portal_item", data.id, { accessId: access.id }),
    ]);
    if (!inserted.results.length) throw new ApiError(409, "portal_access_changed", "O acesso mudou. Atualize antes de compartilhar.");
  } catch (error) {
    if (!String(error).includes("UNIQUE constraint")) throw error;
    const existing = await portalItem(context.db, context.organization.id, access.id, data.id);
    if (existing.title !== data.title || existing.body !== data.body || existing.kind !== data.kind || existing.due_date !== data.dueDate || existing.source_diary_id !== data.sourceDiaryId || existing.photo_ids_json !== JSON.stringify(data.photoIds)) throw new ApiError(409, "portal_item_conflict", "Esta tentativa já foi utilizada. Atualize a lista antes de continuar.");
  }
  return itemResponse(context.db, await portalItem(context.db, context.organization.id, access.id, data.id), true);
}
export async function withdrawPortalItem(context: OrganizationContext, id: string, body: unknown) {
  const parsed = z.object({ accessId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).strict().safeParse(body);
  if (!parsed.success) throw validationError(parsed.error.flatten());
  const { accessId, reason } = parsed.data;
  await managerAccess(context, accessId);
  await portalItem(context.db, context.organization.id, accessId, id);
  const [updated] = await context.db.batch([
    context.db.prepare(`UPDATE client_portal_items SET status = 'withdrawn', withdrawal_reason = ?1, withdrawn_by_name = ?2, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?3 AND organization_id = ?4 AND access_id = ?5 AND status = 'open' RETURNING id`).bind(reason, context.user.displayName, id, context.organization.id, accessId),
    conditionalAudit(context, "portal.item_withdrawn", "client_portal_item", id),
  ]);
  if (!updated.results.length) throw new ApiError(409, "portal_item_closed", "Este item já foi respondido ou retirado. Seu histórico permanece preservado.");
  return { withdrawn: true };
}
export async function decidePortalItem(request: Request, accessId: string, id: string, body: unknown) {
  checkPortalOrigin(request);
  const { db, access, identity } = await clientAccess(request, accessId);
  const parsed = portalDecisionSchema.safeParse(body); if (!parsed.success) throw validationError(parsed.error.flatten());
  const data = parsed.data;
  if (!access.can_approve) throw new ApiError(403, "portal_approval_forbidden", "A empresa não liberou aprovações para este acesso.");
  const existing = await portalItem(db, access.organization_id, accessId, id);
  if (existing.decision_id === data.id && existing.choice === data.choice && existing.comment === data.comment) return { decided: true };
  if (existing.kind !== "approval" || existing.status !== "open") throw new ApiError(409, "portal_item_closed", "Esta solicitação já foi respondida ou retirada.");
  const evidence = await requestEvidenceHashes(request);
  try {
    const [inserted] = await db.batch([
      db.prepare(`INSERT INTO client_portal_decisions (id, organization_id, access_id, item_id, choice, comment, actor_user_id, actor_name, actor_email, ip_hash, user_agent_hash)
        SELECT ?1, i.organization_id, i.access_id, i.id, ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM client_portal_items i JOIN client_portal_access a ON a.id = i.access_id AND a.organization_id = i.organization_id
        WHERE i.id = ?9 AND i.organization_id = ?10 AND i.access_id = ?11 AND i.kind = 'approval' AND i.status = 'open' AND a.status = 'active' AND a.can_approve = 1 AND a.external_user_id = ?4 AND a.revision = ?12
        AND EXISTS (SELECT id FROM client_portal_acceptances WHERE access_id = a.id AND external_user_id = ?4 AND terms_version = ?13) RETURNING id`)
        .bind(data.id, data.choice, data.comment, identity.id, identity.displayName, identity.email, evidence.ipHash, evidence.userAgentHash, id, access.organization_id, accessId, access.revision, CURRENT_TERMS_VERSION),
      db.prepare(`UPDATE client_portal_items SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND organization_id = ?3 AND access_id = ?4 AND status = 'open'
        AND EXISTS (SELECT id FROM client_portal_decisions WHERE id = ?5 AND item_id = ?2 AND organization_id = ?3)`)
        .bind(data.choice, id, access.organization_id, accessId, data.id),
    ]);
    if (!inserted.results.length) throw new ApiError(409, "portal_item_changed", "A solicitação ou o acesso mudou. Atualize o portal antes de responder.");
  } catch (error) {
    if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "portal_decision_conflict", "Uma resposta já foi registrada. Atualize o histórico.");
    throw error;
  }
  return { decided: true };
}
