import { apiRoute } from "@/lib/server/backend";
import { diaryContext, entryPhotos, listDiary, privateHeaders } from "@/lib/server/diary";
import { diaryReportHtml } from "@/lib/server/diary-report";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await diaryContext(request);
    const { entries } = await listDiary(context, new URL(request.url), true);
    const rows = [];
    for (const entry of entries) rows.push({ ...entry, photos: await entryPhotos(context, entry.id) });
    const nonce = crypto.randomUUID();
    const generatedAt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: context.organization.timezone }).format(new Date());
    return new Response(diaryReportHtml(context.organization.name, rows, generatedAt, nonce), { headers: { ...privateHeaders,
      "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` } });
  });
}
