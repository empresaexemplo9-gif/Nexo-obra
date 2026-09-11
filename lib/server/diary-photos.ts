import { z } from "zod";
import { detectedPhotoType, MAX_DIARY_PHOTO_BYTES, MAX_DIARY_PHOTOS } from "@/lib/diary";
import { ApiError, auditStatement, requireModulePermission, type OrganizationContext } from "@/lib/server/backend";
import { diaryEntry, photoResponse, type PhotoRow } from "@/lib/server/diary";
import { diaryBucket } from "@/lib/server/diary-storage";

export async function boundedForm(request: Request) {
  const max = MAX_DIARY_PHOTO_BYTES + 64 * 1024;
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new ApiError(415, "invalid_upload", "Envie uma foto pelo formulário.");
  if (Number(request.headers.get("content-length")) > max) throw new ApiError(413, "photo_too_large", "Cada foto pode ter no máximo 5 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_upload", "Escolha uma foto.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new ApiError(413, "photo_too_large", "Cada foto pode ter no máximo 5 MB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw new ApiError(400, "invalid_upload", "Não foi possível ler a foto enviada."); }
}

export async function saveDiaryPhoto(context: OrganizationContext, entryId: string, form: FormData) {
  requireModulePermission(context, "diary", "edit");
  await diaryEntry(context, entryId);
  const file = form.get("photo");
  const parsed = z.object({ id: z.string().uuid(), caption: z.string().trim().max(300) }).safeParse({ id: form.get("id"), caption: form.get("caption") ?? "" });
  if (!parsed.success || !file || typeof file === "string") throw new ApiError(400, "invalid_photo", "Escolha uma foto e revise a legenda (até 300 caracteres).");
  if (!file.size || file.size > MAX_DIARY_PHOTO_BYTES) throw new ApiError(413, "photo_too_large", "Envie uma foto de até 5 MB.");
  const bytes = await file.arrayBuffer();
  const mimeType = detectedPhotoType(new Uint8Array(bytes));
  if (!mimeType || (file.type && file.type !== mimeType)) throw new ApiError(415, "invalid_photo_type", "Use uma foto JPEG, PNG ou WebP válida. HEIC, SVG e documentos não são aceitos.");
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { id, caption } = parsed.data;
  const existing = await context.db.prepare("SELECT * FROM diary_photos WHERE organization_id = ?1 AND entry_id = ?2 AND id = ?3")
    .bind(context.organization.id, entryId, id).first<PhotoRow>();
  if (existing) {
    if (existing.sha256 !== sha256 || existing.caption !== caption) throw new ApiError(409, "photo_id_conflict", "Esta tentativa já foi usada para outra foto.");
    return photoResponse(existing, entryId);
  }
  const slots = await context.db.prepare("SELECT slot FROM diary_photos WHERE organization_id = ?1 AND entry_id = ?2")
    .bind(context.organization.id, entryId).all<{ slot: number }>();
  const slot = Array.from({ length: MAX_DIARY_PHOTOS }, (_, i) => i + 1).find((value) => !slots.results.some((row) => row.slot === value));
  if (!slot) throw new ApiError(409, "photo_limit", "Este registro já possui 12 fotos. Crie outro registro para documentar mais imagens.");
  const bucket = diaryBucket();
  const key = `diary/${context.organization.id}/${entryId}/${crypto.randomUUID()}`;
  const name = file.name.replaceAll("\\", "/").split("/").at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "Foto";
  await bucket.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  try {
    await context.db.batch([
      context.db.prepare(`INSERT INTO diary_photos (id, organization_id, entry_id, slot, storage_key, name, caption, mime_type, size_bytes, sha256, uploaded_by_member_id, uploaded_by_name)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
        .bind(id, context.organization.id, entryId, slot, key, name, caption, mimeType, file.size, sha256, context.member.id, context.user.displayName),
      auditStatement(context, "diary.photo_added", "site_diary_entry", entryId, { photoId: id, sha256 }),
    ]);
  } catch (error) {
    // A lost DB response is ambiguous: never delete an object that may already be referenced.
    const saved = await context.db.prepare("SELECT * FROM diary_photos WHERE storage_key = ?1 AND organization_id = ?2").bind(key, context.organization.id).first<PhotoRow>();
    if (saved) return photoResponse(saved, entryId);
    await bucket.delete(key);
    if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "photo_upload_conflict", "Outra foto foi adicionada durante o envio. Tente enviar novamente.");
    throw error;
  }
  const saved = await context.db.prepare("SELECT * FROM diary_photos WHERE id = ?1 AND organization_id = ?2 AND entry_id = ?3")
    .bind(id, context.organization.id, entryId).first<PhotoRow>();
  return photoResponse(saved!, entryId);
}
