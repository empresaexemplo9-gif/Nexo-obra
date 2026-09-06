import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  members: number;
  clients: number;
  projects: number;
  open_tasks: number;
};

export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const db = getDatabase();
    const [organizations, totals] = await Promise.all([
      db.prepare(
        `SELECT
          o.id,
          o.name,
          o.slug,
          o.created_at,
          (SELECT COUNT(*) FROM members m WHERE m.organization_id = o.id AND m.active = 1) AS members,
          (SELECT COUNT(*) FROM clients c WHERE c.organization_id = o.id) AS clients,
          (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id) AS projects,
          (SELECT COUNT(*) FROM tasks t WHERE t.organization_id = o.id AND t.status != 'done') AS open_tasks
        FROM organizations o
        ORDER BY o.created_at DESC
        LIMIT 100`,
      ).all<OrganizationRow>(),
      db.prepare(
        `SELECT
          (SELECT COUNT(*) FROM organizations) AS organizations,
          (SELECT COUNT(*) FROM members WHERE active = 1) AS members,
          (SELECT COUNT(*) FROM clients) AS clients,
          (SELECT COUNT(*) FROM projects) AS projects,
          (SELECT COUNT(*) FROM tasks WHERE status != 'done') AS open_tasks`,
      ).first<{ organizations: number; members: number; clients: number; projects: number; open_tasks: number }>(),
    ]);

    return Response.json({
      totals: totals ?? { organizations: 0, members: 0, clients: 0, projects: 0, open_tasks: 0 },
      organizations: organizations.results.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.created_at,
        members: Number(organization.members),
        clients: Number(organization.clients),
        projects: Number(organization.projects),
        openTasks: Number(organization.open_tasks),
      })),
    });
  });
}
