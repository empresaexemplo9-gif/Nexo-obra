import { jsonBody, requireModulePermission } from "@/lib/server/backend";
import { accessResponse, createPortalAccess, portalJson, portalManager, type AccessRow } from "@/lib/server/portal";
import { portalRoute } from "@/lib/server/portal";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return portalRoute(async () => {
    const context = await portalManager(request);
    const rows = await context.db.prepare(`SELECT a.*, p.name AS project_name, p.code AS project_code, o.name AS organization_name FROM client_portal_access a
      JOIN projects p ON p.id = a.project_id AND p.organization_id = a.organization_id JOIN organizations o ON o.id = a.organization_id
      WHERE a.organization_id = ?1 ORDER BY a.created_at DESC, a.id DESC`).bind(context.organization.id).all<AccessRow>();
    const canReadProjects = context.member.permissions.projects.view;
    const projects = canReadProjects ? await context.db.prepare("SELECT id, name, code FROM projects WHERE organization_id = ?1 ORDER BY name").bind(context.organization.id).all() : { results: [] };
    return portalJson({ accesses: rows.results.map((row) => accessResponse(row)), projects: projects.results });
  });
}
export async function POST(request: Request) {
  return portalRoute(async () => {
    const context = await portalManager(request, "edit", true);
    requireModulePermission(context, "projects", "view");
    return portalJson(await createPortalAccess(context, await jsonBody(request)), 201);
  });
}
