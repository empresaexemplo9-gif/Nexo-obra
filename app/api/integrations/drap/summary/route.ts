import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { DrapIntegrationError, fetchDrapFinancialSummary, isDrapConfigured } from "@/lib/integrations/drap";

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
    } catch (causa) {
      // Trocar toda falha pela mesma frase escondia justamente o que resolve: "não
      // respondeu" mandava esperar, quando o problema era credencial, escopo ou caminho
      // configurado errado — e nenhum dos três melhora com o tempo.
      const conhecida = causa instanceof DrapIntegrationError;
      const codigo = conhecida ? causa.codigo : "erro-inesperado";
      const detalhe = conhecida ? causa.detalhe : "Falha inesperada ao consultar a Drap.";

      // No log do servidor para quem opera a plataforma; no corpo para quem administra a
      // empresa. Token não passa por nenhum dos dois.
      console.error(`[drap/summary] ${codigo}: ${detalhe}`);

      return Response.json(
        { error: detalhe, code: codigo },
        { status: codigo === "sem-credencial" ? 409 : 502, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  });
}
