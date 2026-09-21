import { getDatabase } from "@/db";
import { ApiError, apiRoute } from "@/lib/server/backend";
import { DrapPartnerError, apagarEmpresaNaDrap, isDrapPartnerConfigured } from "@/lib/integrations/drap-partner";
import { contasQueFicamSemEmpresa, instrucoesParaApagarContas, instrucoesParaApagarEmpresa } from "@/lib/server/apagar-empresa";
import { registrarExclusao } from "@/lib/server/exclusoes";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ organizationId: string }> };

/**
 * Apaga uma empresa e tudo que pendurava nela.
 *
 * ─── A ORDEM É A DRAP PRIMEIRO ───
 *
 * A empresa existe dos dois lados, e só a conexão guardada aqui sabe qual empresa lá
 * corresponde a esta. Apagando primeiro daqui, essa ligação some: a empresa na Drap fica
 * viva, sem ninguém que saiba o que ela era, e o documento dela continua ocupado — o CNPJ
 * usado no teste não poderia mais ser cadastrado de verdade.
 *
 * Na ordem inversa o pior caso é benigno: some de lá, falha aqui, e basta repetir.
 *
 * ─── RECUSA DA DRAP NÃO VIRA EXCLUSÃO PELA METADE ───
 *
 * A Drap recusa apagar empresa que ela não provisionou, ou que tem gente acessando
 * diretamente. Seguir em frente apagaria o vínculo e deixaria a empresa órfã lá para
 * sempre. Então a recusa para tudo e é dita com o motivo dela.
 *
 * Quem realmente quiser apagar só daqui manda `?manterNaDrap=1`. É uma escolha, fica
 * escrita no registro da exclusão, e não acontece por acidente.
 */
export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const { organizationId } = await route.params;
    const manterNaDrap = new URL(request.url).searchParams.get("manterNaDrap") === "1";

    const db = getDatabase();
    const empresa = await db.prepare("SELECT id, name, slug FROM organizations WHERE id = ?1")
      .bind(organizationId).first<{ id: string; name: string; slug: string }>();
    if (!empresa) throw new ApiError(404, "organization_not_found", "Empresa não encontrada.");

    const conexao = await db.prepare(
      "SELECT external_company_id FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1",
    ).bind(organizationId).first<{ external_company_id: string }>();

    let empresaRemotaApagada = false;
    if (conexao?.external_company_id && !manterNaDrap) {
      if (!isDrapPartnerConfigured()) {
        throw new ApiError(
          409,
          "drap_partner_not_configured",
          "Esta empresa tem financeiro na Drap e a conexão de parceiro não está configurada aqui. Para apagar mesmo assim, confirme que a empresa continuará existindo na Drap.",
        );
      }
      try {
        await apagarEmpresaNaDrap(conexao.external_company_id);
        empresaRemotaApagada = true;
      } catch (causa) {
        // O motivo vem da Drap e muda a decisão de quem está apagando — "tem gente
        // acessando" pede conversa, não uma segunda tentativa.
        const detalhe = causa instanceof DrapPartnerError ? causa.detalhe : "A Drap não respondeu.";
        throw new ApiError(
          409,
          "drap_recusou_exclusao",
          `${detalhe} Para apagar apenas na H.OIKOS, confirme que a empresa continuará existindo na Drap.`,
        );
      }
    }

    // Antes da exclusão: depois, as linhas que respondem "quem fica sem empresa nenhuma?"
    // já não existem.
    const orfas = await contasQueFicamSemEmpresa(db, organizationId);
    const instrucoes = await instrucoesParaApagarEmpresa(db, organizationId);

    await db.batch([
      ...instrucoes,
      ...instrucoesParaApagarContas(db, orfas),
      registrarExclusao(db, {
        tipo: "organization",
        subjectId: organizationId,
        rotulo: empresa.name,
        actor: admin.email,
        detalhes: {
          slug: empresa.slug,
          contasApagadas: orfas.length,
          empresaNaDrap: conexao?.external_company_id
            ? (empresaRemotaApagada ? "apagada" : "mantida")
            : "nao-conectada",
        },
      }),
    ]);

    return Response.json(
      { apagada: true, contasApagadas: orfas.length, empresaRemotaApagada },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
