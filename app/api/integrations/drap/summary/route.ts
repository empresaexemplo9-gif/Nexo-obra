import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { fetchDrapFinancialSummary, isDrapConfigured } from "@/lib/integrations/drap";

export const dynamic = "force-dynamic";

type ConnectionRow = { external_company_id: string; status: string };

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");

    if (!isDrapConfigured()) {
      return Response.json(
        {
          error: "A integração financeira ainda não foi configurada.",
          code: "integration_not_configured",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const connection = await context.db.prepare(
      `SELECT external_company_id, status
       FROM integration_connections
       WHERE organization_id = ?1 AND provider = 'drap'
       LIMIT 1`,
    ).bind(context.organization.id).first<ConnectionRow>();

    if (!connection || connection.status !== "active") {
      return Response.json(
        {
          error: "Conecte a Drap para consultar os dados financeiros desta empresa.",
          code: "drap_connection_required",
        },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    try {
      const summary = await fetchDrapFinancialSummary(connection.external_company_id);
      return Response.json(summary, {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch {
      return Response.json(
        {
          error: "A Drap não respondeu. Tente novamente em alguns instantes.",
          code: "drap_unavailable",
        },
        { status: 502, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  });
}
