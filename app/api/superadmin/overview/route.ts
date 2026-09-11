import { getDatabase } from "@/db";
import { apiRoute } from "@/lib/server/backend";
import { MAINTENANCE_ORGANIZATION_ID } from "@/lib/server/maintenance";
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
    // O ambiente de manutenção não é uma empresa contratante: sai das contagens e
    // aparece em bloco próprio, com o histórico de entradas da plataforma.
    const [organizations, totals, maintenance] = await Promise.all([
      db.prepare(
        `SELECT
          o.id,
          o.name,
          o.slug,
          o.created_at,
          (SELECT COUNT(*) FROM members m WHERE m.organization_id = o.id AND m.active = 1 AND m.role != 'superadmin') AS members,
          (SELECT COUNT(*) FROM clients c WHERE c.organization_id = o.id) AS clients,
          (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id) AS projects,
          (SELECT COUNT(*) FROM tasks t WHERE t.organization_id = o.id AND t.status != 'done') AS open_tasks
        FROM organizations o
        WHERE o.id != ?1
        ORDER BY o.created_at DESC
        LIMIT 100`,
      ).bind(MAINTENANCE_ORGANIZATION_ID).all<OrganizationRow>(),
      db.prepare(
        `SELECT
          (SELECT COUNT(*) FROM organizations WHERE id != ?1) AS organizations,
          (SELECT COUNT(*) FROM members WHERE active = 1 AND role != 'superadmin' AND organization_id != ?1) AS members,
          (SELECT COUNT(*) FROM clients WHERE organization_id != ?1) AS clients,
          (SELECT COUNT(*) FROM projects WHERE organization_id != ?1) AS projects,
          (SELECT COUNT(*) FROM tasks WHERE status != 'done' AND organization_id != ?1) AS open_tasks`,
      ).bind(MAINTENANCE_ORGANIZATION_ID).first<{ organizations: number; members: number; clients: number; projects: number; open_tasks: number }>(),
      db.prepare(
        `SELECT
          (SELECT COUNT(*) FROM organizations WHERE id = ?1) AS ready,
          (SELECT COUNT(*) FROM members WHERE organization_id = ?1 AND active = 1 AND role != 'superadmin') AS members,
          (SELECT COUNT(*) FROM projects WHERE organization_id = ?1) AS projects,
          (SELECT COUNT(*) FROM tasks WHERE organization_id = ?1 AND status != 'done') AS open_tasks,
          (SELECT MAX(created_at) FROM platform_audit_events
            WHERE organization_id = ?1 AND action = 'platform.maintenance_opened') AS last_entry_at`,
      ).bind(MAINTENANCE_ORGANIZATION_ID).first<{ ready: number; members: number; projects: number; open_tasks: number; last_entry_at: number | null }>(),
    ]);

    return Response.json({
      totals: totals ?? { organizations: 0, members: 0, clients: 0, projects: 0, open_tasks: 0 },
      maintenance: {
        id: MAINTENANCE_ORGANIZATION_ID,
        ready: Number(maintenance?.ready ?? 0) > 0,
        members: Number(maintenance?.members ?? 0),
        projects: Number(maintenance?.projects ?? 0),
        openTasks: Number(maintenance?.open_tasks ?? 0),
        lastEntryAt: maintenance?.last_entry_at ?? null,
      },
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
