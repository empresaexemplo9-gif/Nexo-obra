import { apiRoute, jsonBody } from "@/lib/server/backend";
import { createDiary, diaryContext, diaryJson, listDiary } from "@/lib/server/diary";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiRoute(async () => diaryJson(await listDiary(await diaryContext(request), new URL(request.url))));
}
export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await diaryContext(request, "edit");
    return diaryJson({ entry: await createDiary(context, await jsonBody(request)) }, 201);
  });
}
