import { ApiError, apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { fetchDrapTransactions, hasAnyDrapTransaction, isDrapTransactionsConfigured } from "@/lib/integrations/drap";
import { requireActiveDrapConnection } from "@/lib/server/drap";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    if (!isDrapTransactionsConfigured()) return Response.json({ error: "A integração real com a Drap não está configurada para esta instalação.", code: "drap_transactions_not_configured" }, { status: 503 });
    const connection = await requireActiveDrapConnection(context);
    const projectId = new URL(request.url).searchParams.get("projectId");
    let costCenterId: string | null = null;
    if (projectId) {
      const project = await context.db.prepare("SELECT external_financial_cost_center_id FROM projects WHERE id = ?1 AND organization_id = ?2").bind(projectId, context.organization.id).first<{ external_financial_cost_center_id: string | null }>();
      if (!project) throw new ApiError(404, "not_found", "Projeto ou obra não encontrado.");
      if (!project.external_financial_cost_center_id) throw new ApiError(409, "project_cost_center_required", "Vincule esta obra a um centro de custo da Drap.");
      costCenterId = project.external_financial_cost_center_id;
    }
    try {
      const transactions = await fetchDrapTransactions(connection.external_company_id, costCenterId);
      // Lista vazia no recorte de obra tem duas causas com desenhos idênticos:
      // a obra não movimentou nada ainda, ou o centro de custo vinculado não
      // corresponde a nenhum lançamento na Drap. A segunda é erro de cadastro
      // e precisa aparecer como erro; sem isso a tela mente em silêncio.
      let emptyReason: "company_without_transactions" | "cost_center_without_match" | null = null;
      if (costCenterId && transactions.length === 0) {
        try {
          emptyReason = (await hasAnyDrapTransaction(connection.external_company_id))
            ? "cost_center_without_match"
            : "company_without_transactions";
        } catch {
          // A consulta principal respondeu; não derruba a tela por causa do diagnóstico.
          emptyReason = null;
        }
      }
      return Response.json(
        { transactions, scope: projectId ? "project" : "organization", source: "drap", costCenterId, emptyReason },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch {
      return Response.json({ error: "A Drap não respondeu à consulta de contas.", code: "drap_unavailable" }, { status: 502 });
    }
  });
}
