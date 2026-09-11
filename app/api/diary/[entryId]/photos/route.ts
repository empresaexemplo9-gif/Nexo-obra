import { apiRoute } from "@/lib/server/backend";
import { diaryContext, diaryEntry, diaryJson } from "@/lib/server/diary";
import { boundedForm, saveDiaryPhoto } from "@/lib/server/diary-photos";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  return apiRoute(async () => {
    const context = await diaryContext(request, "edit");
    const { entryId } = await params;
    await diaryEntry(context, entryId);
    return diaryJson({ photo: await saveDiaryPhoto(context, entryId, await boundedForm(request)) }, 201);
  });
}
