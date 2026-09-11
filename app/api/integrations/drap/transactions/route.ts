import { ApiError, apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { fetchDrapTransactions, isDrapTransactionsConfigured } from "@/lib/integrations/drap";
import { requireActiveDrapConnection } from "@/lib/server/drap";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    if (!isDrapTransactionsConfigured()) return Response.json({ error: "A consulta de contas da Drap ainda não foi homologada.", code: "drap_transactions_not_configured" }, { status: 503 });
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
      return Response.json({ transactions, scope: projectId ? "project" : "organization", source: "drap" }, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return Response.json({ error: "A Drap não respondeu à consulta de contas.", code: "drap_unavailable" }, { status: 502 });
    }
  });
}
