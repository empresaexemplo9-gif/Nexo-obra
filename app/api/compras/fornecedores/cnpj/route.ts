import { ApiError, apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { consultarCnpj, FalhaNaConsulta } from "@/lib/integrations/cnpj";

export const dynamic = "force-dynamic";

// Preenche o cadastro de um fornecedor com os dados oficiais da Receita. Só leitura: o
// "verificado" é gravado pela rota do próprio fornecedor, que consulta de novo.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const cnpj = new URL(request.url).searchParams.get("cnpj") ?? "";
    try {
      return Response.json({ registry: await consultarCnpj(cnpj) }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (error instanceof FalhaNaConsulta) throw new ApiError(error.motivo === "indisponivel" ? 503 : error.motivo === "inexistente" ? 404 : error.motivo === "incompativel" ? 502 : 400, `cnpj_${error.motivo}`, error.message);
      throw error;
    }
  });
}
