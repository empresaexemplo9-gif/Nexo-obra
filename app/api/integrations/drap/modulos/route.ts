import { DrapApiError, fetchDrapModules } from "@/lib/integrations/drap";
import { ApiError, apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { requireActiveDrapConnection } from "@/lib/server/drap";

export const dynamic = "force-dynamic";

// O que a empresa tem contratado na Drap, para a tela conseguir dizer "Emissão de nota:
// inativa" ANTES de qualquer clique.
//
// Sem isto, a única forma de descobrir seria tentar a ação e levar 403 — descobrir a
// permissão errando, na frente do usuário.
//
// Não existe POST aqui, e não é omissão: contratar módulo é assinatura recorrente no
// cartão de quem paga. A H.OIKOS mostra o estado e o preço e leva a pessoa até a conta
// dela; assinar por ela seria decidir uma cobrança mensal em nome de alguém.

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const connection = await requireActiveDrapConnection(context);

    try {
      const estado = await fetchDrapModules(connection.external_company_id);
      return Response.json(estado, { headers: { "Cache-Control": "private, no-store" } });
    } catch (cause) {
      if (cause instanceof DrapApiError) {
        // 403 aqui é a chave desta empresa sem `modulos:read` — quase sempre uma chave
        // emitida antes de o recurso existir. Dizer isso poupa uma investigação.
        if (cause.status === 403) {
          throw new ApiError(
            409,
            "escopo_ausente",
            "A credencial desta empresa foi emitida antes da leitura de módulos existir na Drap. Reconecte a empresa para emitir uma credencial nova.",
          );
        }
        if (cause.status === 404) {
          throw new ApiError(
            409,
            "recurso_indisponivel",
            "Esta instalação da Drap ainda não publica o estado dos módulos.",
          );
        }
        throw new ApiError(502, "drap_indisponivel", "A Drap não respondeu à consulta de módulos.");
      }
      throw cause;
    }
  });
}
