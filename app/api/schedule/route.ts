import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { taskSelect, type TaskRow } from "@/lib/server/tasks-records";

export const dynamic = "force-dynamic";

// Schedule readers receive planning fields without gaining task editing or descriptions.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "schedule", "view");
    const rows = await context.db.prepare(`${taskSelect} WHERE t.organization_id = ?1 ORDER BY t.due_at, t.updated_at DESC LIMIT 200`)
      .bind(context.organization.id).all<TaskRow>();
    return Response.json({ tasks: rows.results.map(row => ({
      id: row.id, projectId: row.project_id, projectName: row.project_name, title: row.title,
      status: row.status, priority: row.priority, assigneeName: row.assignee_name,
      parentTaskId: row.parent_task_id, startsAt: row.starts_at, dueAt: row.due_at,
      estimatedMinutes: row.estimated_minutes,
    })) });
  });
}
