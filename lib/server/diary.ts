import { z } from "zod";
import { createDiarySchema, updateDiarySchema, diaryQuerySchema, DIARY_PAGE_SIZE, type DiaryEntry, type DiaryFields, type DiaryPhoto, type DiaryRevision } from "@/lib/diary";
import { ApiError, auditStatement, ensureFound, requireModulePermission, requireOrganizationContext, validationError, type OrganizationContext } from "@/lib/server/backend";

export const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
export const diaryJson = (data: unknown, status = 200) => Response.json(data, { status, headers: privateHeaders });

export async function diaryContext(request: Request, action: "view" | "edit" = "view") {
  const context = await requireOrganizationContext(request);
  requireModulePermission(context, "diary", action);
  if (action === "edit") {
    const origin = request.headers.get("origin");
    if (origin && ![new URL(request.url).origin, "https://nexo-obra-jet.vercel.app", "https://nexo-obra.thiagohcarvalho09.chatgpt.site"].includes(origin)) {
      throw new ApiError(403, "invalid_origin", "Origem não permitida.");
    }
  }
  return context;
}

export function validId(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Registro não encontrado.");
  return id;
}

type EntryRow = {
  id: string; project_id: string; project_name: string; project_code: string; entry_date: string; weather: DiaryFields["weather"];
  workforce_count: number; summary: string; blockers: string; occurrence_type: DiaryFields["occurrenceType"];
  author_member_id: string | null; author_name: string; revision: number; created_at: string; updated_at: string; photo_count: number;
};
const entrySelect = `SELECT d.*, p.name AS project_name, p.code AS project_code,
  COALESCE(NULLIF(d.author_name, ''), m.name, 'Autor não informado') AS author_name,
  (SELECT COUNT(*) FROM diary_photos f WHERE f.entry_id = d.id AND f.organization_id = d.organization_id) AS photo_count
  FROM site_diary_entries d JOIN projects p ON p.id = d.project_id AND p.organization_id = d.organization_id
  LEFT JOIN members m ON m.id = d.author_member_id AND m.organization_id = d.organization_id`;

export function entryResponse(row: EntryRow): DiaryEntry {
  return { id: row.id, projectId: row.project_id, projectName: row.project_name, projectCode: row.project_code,
    entryDate: row.entry_date, weather: row.weather || "unreported", workforceCount: row.workforce_count,
    summary: row.summary, blockers: row.blockers, occurrenceType: row.occurrence_type === "none" && row.blockers ? "general" : row.occurrence_type,
    authorName: row.author_name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, photoCount: row.photo_count };
}

export async function diaryEntry(context: OrganizationContext, id: string) {
  return ensureFound(await context.db.prepare(`${entrySelect} WHERE d.organization_id = ?1 AND d.id = ?2`)
    .bind(context.organization.id, validId(id)).first<EntryRow>(), "Registro");
}

export async function diaryProject(context: OrganizationContext, projectId: string) {
  return ensureFound(await context.db.prepare("SELECT id, name, code FROM projects WHERE organization_id = ?1 AND id = ?2")
    .bind(context.organization.id, projectId).first<{ id: string; name: string; code: string }>(), "Obra");
}

export function diaryFilters(url: URL, organizationId: string) {
  const parsed = diaryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
  const query = parsed.data;
  const filters = ["d.organization_id = ?1"];
  const values: (string | number)[] = [organizationId];
  const add = (sql: string, value: string) => { values.push(value); filters.push(sql.replaceAll("?", `?${values.length}`)); };
  if (query.projectId) add("d.project_id = ?", query.projectId);
  if (query.from) add("d.entry_date >= ?", query.from);
  if (query.to) add("d.entry_date <= ?", query.to);
  if (query.q) add("(instr(lower(d.summary), lower(?)) > 0 OR instr(lower(d.blockers), lower(?)) > 0)", query.q);
  if (query.occurrencesOnly === "true") filters.push("d.blockers <> ''");
  return { query, where: filters.join(" AND "), values };
}

export async function listDiary(context: OrganizationContext, url: URL, report = false) {
  const { query, where, values } = diaryFilters(url, context.organization.id);
  if (query.projectId) await diaryProject(context, query.projectId);
  const size = report ? 31 : DIARY_PAGE_SIZE;
  // Count and page share one database transaction, including when a colleague adds a record.
  const [count, rows] = await context.db.batch([
    context.db.prepare(`SELECT COUNT(*) AS total FROM site_diary_entries d WHERE ${where}`).bind(...values),
    context.db.prepare(`${entrySelect} WHERE ${where} ORDER BY d.entry_date DESC, d.created_at DESC, d.id DESC LIMIT ?${values.length + 1} OFFSET ?${values.length + 2}`)
      .bind(...values, size, report ? 0 : (query.page - 1) * size),
  ]);
  const total = (count.results[0] as { total: number }).total;
  if (report && total > size) throw new ApiError(422, "report_too_large", "Este relatório tem mais de 31 registros. Reduza o período ou selecione uma obra.");
  return { entries: (rows.results as EntryRow[]).map(entryResponse), total, page: query.page, pageSize: size };
}

function fields(entry: DiaryFields): DiaryFields {
  return { entryDate: entry.entryDate, weather: entry.weather, workforceCount: entry.workforceCount, summary: entry.summary, blockers: entry.blockers, occurrenceType: entry.occurrenceType };
}

function revisionStatement(context: OrganizationContext, entryId: string, revision: number, snapshot: DiaryFields, reason: string, editorName = context.user.displayName) {
  return context.db.prepare(`INSERT INTO diary_revisions (id, organization_id, entry_id, revision, snapshot_json, editor_member_id, editor_name, reason)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(crypto.randomUUID(), context.organization.id, entryId, revision, JSON.stringify(fields(snapshot)), context.member.id, editorName, reason);
}

export async function createDiary(context: OrganizationContext, body: unknown) {
  requireModulePermission(context, "diary", "edit");
  const parsed = createDiarySchema.safeParse(body);
  if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
  const data = parsed.data;
  await diaryProject(context, data.projectId);
  try {
    await context.db.batch([
      context.db.prepare(`INSERT INTO site_diary_entries (id, organization_id, project_id, entry_date, weather, workforce_count, summary, blockers, occurrence_type, author_member_id, author_name)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(data.id, context.organization.id, data.projectId, data.entryDate, data.weather, data.workforceCount, data.summary, data.blockers, data.occurrenceType, context.member.id, context.user.displayName),
      revisionStatement(context, data.id, 1, data, "Registro inicial"),
      auditStatement(context, "diary.created", "site_diary_entry", data.id, { projectId: data.projectId, revision: 1 }),
    ]);
  } catch (error) {
    if (!String(error).includes("UNIQUE constraint")) throw error;
    const existing = await context.db.prepare("SELECT project_id, author_member_id FROM site_diary_entries WHERE id = ?1 AND organization_id = ?2")
      .bind(data.id, context.organization.id).first<{ project_id: string; author_member_id: string }>();
    const original = await context.db.prepare("SELECT snapshot_json FROM diary_revisions WHERE entry_id = ?1 AND organization_id = ?2 AND revision = 1")
      .bind(data.id, context.organization.id).first<{ snapshot_json: string }>();
    if (!existing || existing.project_id !== data.projectId || existing.author_member_id !== context.member.id || original?.snapshot_json !== JSON.stringify(fields(data))) {
      throw new ApiError(409, "diary_id_conflict", "Esta tentativa já foi usada para outro registro. Atualize a lista antes de continuar.");
    }
  }
  return entryResponse(await diaryEntry(context, data.id));
}

export async function updateDiary(context: OrganizationContext, id: string, body: unknown) {
  requireModulePermission(context, "diary", "edit");
  const parsed = updateDiarySchema.safeParse(body);
  if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
  const data = parsed.data;
  const current = await diaryEntry(context, id);
  const conflict = () => new ApiError(409, "diary_revision_conflict", "Outra pessoa já alterou este registro. Seu texto foi mantido no formulário; consulte a versão atual antes de corrigir novamente.");
  if (current.revision !== data.revision) throw conflict();
  try {
    const statements = [];
    const original = await context.db.prepare("SELECT id FROM diary_revisions WHERE entry_id = ?1 AND organization_id = ?2 AND revision = ?3")
      .bind(id, context.organization.id, current.revision).first();
    if (!original) statements.push(revisionStatement(context, id, current.revision, entryResponse(current), "Versão anterior à ativação do histórico", current.author_name));
    // The unique (entry_id, revision) insert is the concurrency guard: a losing writer rolls back the whole batch.
    statements.push(revisionStatement(context, id, data.revision + 1, data, data.reason));
    statements.push(context.db.prepare(`UPDATE site_diary_entries SET entry_date = ?1, weather = ?2, workforce_count = ?3, summary = ?4,
      blockers = ?5, occurrence_type = ?6, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?7 AND organization_id = ?8 AND revision = ?9`)
      .bind(data.entryDate, data.weather, data.workforceCount, data.summary, data.blockers, data.occurrenceType, id, context.organization.id, data.revision));
    statements.push(auditStatement(context, "diary.corrected", "site_diary_entry", id, { revision: data.revision + 1 }));
    await context.db.batch(statements);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint")) throw conflict();
    throw error;
  }
  return entryResponse(await diaryEntry(context, id));
}

export type PhotoRow = { id: string; storage_key: string; name: string; caption: string; mime_type: string; size_bytes: number; sha256: string; uploaded_by_name: string; created_at: string };
export function photoResponse(photo: PhotoRow, entryId: string): DiaryPhoto {
  return { id: photo.id, name: photo.name, caption: photo.caption, mimeType: photo.mime_type, sizeBytes: photo.size_bytes, sha256: photo.sha256,
    uploadedByName: photo.uploaded_by_name, createdAt: photo.created_at, url: `/api/diary/${entryId}/photos/${photo.id}` };
}
export async function entryPhotos(context: OrganizationContext, id: string) {
  const photos = await context.db.prepare("SELECT * FROM diary_photos WHERE organization_id = ?1 AND entry_id = ?2 ORDER BY slot")
    .bind(context.organization.id, id).all<PhotoRow>();
  return photos.results.map((photo) => photoResponse(photo, id));
}

export async function diaryDetail(context: OrganizationContext, id: string, historyBefore?: string | null) {
  const entry = entryResponse(await diaryEntry(context, id));
  const before = historyBefore ? z.coerce.number().int().positive().safeParse(historyBefore) : null;
  if (before && !before.success) throw new ApiError(400, "invalid_revision", "Versão inválida.");
  const [photos, history] = await Promise.all([
    entryPhotos(context, id),
    context.db.prepare(`SELECT revision, snapshot_json, editor_name, reason, created_at FROM diary_revisions
      WHERE organization_id = ?1 AND entry_id = ?2 AND revision < ?3 ORDER BY revision DESC LIMIT 21`)
      .bind(context.organization.id, id, before?.success ? before.data : entry.revision + 1)
      .all<{ revision: number; snapshot_json: string; editor_name: string; reason: string; created_at: string }>(),
  ]);
  const revisions: DiaryRevision[] = history.results.slice(0, 20).map((row) => ({ revision: row.revision, snapshot: JSON.parse(row.snapshot_json), editorName: row.editor_name, reason: row.reason, createdAt: row.created_at }));
  return { entry, photos, revisions, nextHistoryBefore: history.results.length > 20 ? revisions.at(-1)!.revision : null };
}
