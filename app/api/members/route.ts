import { apiRoute, requireOrganizationContext } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  weekly_capacity_minutes: number;
  active: number;
};

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const result = await context.db.prepare(
      `SELECT id, name, email, role, weekly_capacity_minutes, active
       FROM members
       WHERE organization_id = ?1 AND active = 1
       ORDER BY name`,
    ).bind(context.organization.id).all<MemberRow>();

    return Response.json({
      members: result.results.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        weeklyCapacityMinutes: member.weekly_capacity_minutes,
        active: member.active === 1,
      })),
    });
  });
}
