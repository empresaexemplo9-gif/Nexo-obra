import { apiRoute, ensureFound } from "@/lib/server/backend";
import { diaryContext, diaryEntry, privateHeaders, validId, type PhotoRow } from "@/lib/server/diary";
import { getObject } from "@/lib/server/storage";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ entryId: string; photoId: string }> }) {
  return apiRoute(async () => {
    const context = await diaryContext(request);
    const { entryId, photoId } = await params;
    await diaryEntry(context, entryId);
    const photo = ensureFound(await context.db.prepare("SELECT * FROM diary_photos WHERE organization_id = ?1 AND entry_id = ?2 AND id = ?3")
      .bind(context.organization.id, entryId, validId(photoId)).first<PhotoRow>(), "Foto");
    const object = ensureFound(await getObject(photo.storage_key), "Foto");
    const extension = photo.mime_type === "image/png" ? "png" : photo.mime_type === "image/webp" ? "webp" : "jpg";
    return new Response(object.body, { headers: { ...privateHeaders, "Content-Type": photo.mime_type,
      "Content-Length": String(photo.size_bytes), "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `inline; filename="foto-${photo.id}.${extension}"` } });
  });
}
