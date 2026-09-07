import { ApiError, ensureFound } from "@/lib/server/backend";
import { privateHeaders, type PhotoRow } from "@/lib/server/diary";
import { diaryBucket } from "@/lib/server/diary-storage";
import { portalId, portalItem } from "@/lib/server/portal";
export async function portalPhoto(db: D1Database, orgId: string, accessId: string, itemId: string, photoId: string, admin = false) {
  const item = await portalItem(db, orgId, accessId, itemId);
  if ((!admin && item.status === "withdrawn") || !(JSON.parse(item.photo_ids_json) as string[]).includes(portalId(photoId))) throw new ApiError(404, "not_found", "Foto não encontrada.");
  const photo = ensureFound(await db.prepare("SELECT * FROM diary_photos WHERE id = ?1 AND organization_id = ?2 AND entry_id = ?3")
    .bind(photoId, orgId, item.source_diary_id).first<PhotoRow>(), "Foto");
  const object = ensureFound(await diaryBucket().get(photo.storage_key), "Foto");
  return new Response(object.body, { headers: { ...privateHeaders, "Content-Type": photo.mime_type, "Content-Length": String(photo.size_bytes),
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" } });
}
