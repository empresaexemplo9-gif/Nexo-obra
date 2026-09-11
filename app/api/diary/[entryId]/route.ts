import { apiRoute, jsonBody } from "@/lib/server/backend";
import { diaryContext, diaryDetail, diaryJson, updateDiary } from "@/lib/server/diary";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ entryId: string }> };
export async function GET(request: Request, { params }: Params) {
  return apiRoute(async () => {
    const context = await diaryContext(request);
    return diaryJson(await diaryDetail(context, (await params).entryId, new URL(request.url).searchParams.get("historyBefore")));
  });
}
export async function PATCH(request: Request, { params }: Params) {
  return apiRoute(async () => {
    const context = await diaryContext(request, "edit");
    return diaryJson({ entry: await updateDiary(context, (await params).entryId, await jsonBody(request)) });
  });
}
