import { apiRoute } from "@/lib/server/backend";
import { diaryContext, diaryJson } from "@/lib/server/diary";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await diaryContext(request);
    // A diary-only collaborator receives project labels, never budgets, clients or financial fields.
    const projects = await context.db.prepare("SELECT id, name, code FROM projects WHERE organization_id = ?1 ORDER BY name, id")
      .bind(context.organization.id).all();
    return diaryJson({ projects: projects.results, timezone: context.organization.timezone });
  });
}
