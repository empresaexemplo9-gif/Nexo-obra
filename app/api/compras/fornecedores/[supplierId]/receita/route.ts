import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { consultarCnpj, FalhaNaConsulta } from "@/lib/integrations/cnpj";
import { listarFornecedores } from "@/lib/server/compras-cadastros";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ supplierId: string }> };

// Confere o CNPJ guardado no fornecedor na Receita e registra razão social, situação
// cadastral, atividade e quando foi conferido. Fornecedor com CNPJ baixado ou inapto
// fica marcado; nada é alterado no restante do cadastro.
export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const { supplierId } = await route.params;
    if (!z.string().uuid().safeParse(supplierId).success) throw new ApiError(404, "not_found", "Fornecedor não encontrado.");
    const fornecedor = ensureFound(await context.db.prepare("SELECT id, document FROM suppliers WHERE id = ?1 AND organization_id = ?2")
      .bind(supplierId, context.organization.id).first<{ id: string; document: string | null }>(), "Fornecedor");
    if (!fornecedor.document || fornecedor.document.length !== 14) throw new ApiError(400, "cnpj_required", "Informe o CNPJ do fornecedor para conferir na Receita.");
    let dados;
    try { dados = await consultarCnpj(fornecedor.document); }
    catch (error) {
      if (error instanceof FalhaNaConsulta) throw new ApiError(error.motivo === "indisponivel" ? 503 : error.motivo === "inexistente" ? 404 : error.motivo === "incompativel" ? 502 : 400, `cnpj_${error.motivo}`, error.message);
      throw error;
    }
    await context.db.batch([
      context.db.prepare("UPDATE suppliers SET registry_name = ?1, registry_status = ?2, registry_activity = ?3, registry_checked_at = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5 AND organization_id = ?6")
        .bind(dados.razaoSocial, dados.situacao || "SEM INFORMAÇÃO", dados.atividade, new Date().toISOString(), supplierId, context.organization.id),
      auditStatement(context, "supplier.registry_checked", "supplier", supplierId, { status: dados.situacao }),
    ]);
    return Response.json({ supplier: (await listarFornecedores(context, true)).find((s) => s.id === supplierId) });
  });
}
