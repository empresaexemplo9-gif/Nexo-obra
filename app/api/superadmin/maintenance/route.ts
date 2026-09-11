import { getDatabase } from "@/db";
import { apiRoute, organizationSelectionCookie } from "@/lib/server/backend";
import { platformAudit } from "@/lib/server/platform-access";
import { MAINTENANCE_ORGANIZATION_ID, MAINTENANCE_ORGANIZATION_NAME, maintenanceOrganizationStatement } from "@/lib/server/maintenance";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

// O administrador de manutenção continua com login próprio e confinado a este ambiente.
// Aqui o superadministrador entra no mesmo ambiente pela sessão da plataforma, sem a
// senha de manutenção e sem perder os recursos que só ele tem.
export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const db = getDatabase();
    await maintenanceOrganizationStatement(db).run();
    await platformAudit(db, MAINTENANCE_ORGANIZATION_ID, admin.email, "platform.maintenance_opened", MAINTENANCE_ORGANIZATION_ID).run();
    return Response.json(
      { organization: { id: MAINTENANCE_ORGANIZATION_ID, name: MAINTENANCE_ORGANIZATION_NAME } },
      { headers: { "Set-Cookie": organizationSelectionCookie(MAINTENANCE_ORGANIZATION_ID), "Cache-Control": "private, no-store" } },
    );
  });
}
