import {
  ApiError, apiRoute, auditStatement, requireModulePermission, requireOrganizationContext,
} from "@/lib/server/backend";
import { requireActiveDrapConnection } from "@/lib/server/drap";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { DrapPartnerError, convidarDonoDaEmpresa, isDrapPartnerConfigured } from "@/lib/integrations/drap-partner";

export const dynamic = "force-dynamic";

// Pede à Drap a conta desta empresa, para quem quiser sair da H.OIKOS e entrar lá.
//
// A empresa provisionada por aqui nasce SEM usuário nenhum: ela existe, opera por API e
// não há conta para ninguém entrar. Isso é o certo enquanto a pessoa quiser ficar só
// aqui — e a maioria vai querer. Esta rota existe para o dia em que ela não quiser.
//
// ─── POR QUE O E-MAIL NÃO VEM DO FORMULÁRIO ───
//
// O convite dá papel de ADMINISTRADOR da empresa na Drap: quem aceita passa a ver o
// financeiro inteiro, trocar de plano e remover a própria H.OIKOS. Aceitar um e-mail
// digitado deixaria um administrador daqui entregar as finanças da empresa para
// qualquer endereço — inclusive um que ele acabou de criar.
//
// Então o convite vai para quem PEDIU, com a identidade que a sessão já provou. Quem
// precisa passar a conta adiante faz isso lá dentro, em Equipe, com o vínculo já feito.

export async function POST(request: Request) {
  return apiRoute(async () => {
    // Mesma trava das outras mutações da integração (#19): um site de terceiro não
    // dispara a entrega da empresa com o cookie de quem está logado aqui.
    rejectCrossSiteMutation(request);
    // Entregar a empresa é ato de dono, não de operação do dia.
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");
    const connection = await requireActiveDrapConnection(context);

    if (!isDrapPartnerConfigured()) {
      throw new ApiError(
        409,
        "parceiro_nao_configurado",
        "Esta instalação não tem credencial de parceiro da Drap para criar o convite.",
      );
    }

    let convite;
    try {
      convite = await convidarDonoDaEmpresa({
        tenantId: connection.external_company_id,
        email: context.user.email,
        nome: context.user.displayName,
      });
    } catch (cause) {
      if (cause instanceof DrapPartnerError) {
        // A Drap recusa quando a empresa já tem alguém dentro. Não é erro: é o caso
        // normal de quem já pediu a conta antes, e a instrução muda por causa disso.
        if (cause.codigo === "empresa-ja-tem-dono") {
          throw new ApiError(
            409,
            "conta_ja_existe",
            "Esta empresa já tem acesso na Drap. Entre com o login que você criou; se esqueceu a senha, use a recuperação lá.",
          );
        }
        if (cause.codigo === "convite-pendente") {
          throw new ApiError(
            409,
            "convite_pendente",
            "Já existe um convite válido para o seu e-mail. Procure a mensagem da Drap na caixa de entrada e no spam.",
          );
        }
        if (cause.codigo === "ja-e-membro") {
          throw new ApiError(
            409,
            "conta_ja_existe",
            "Seu e-mail já tem acesso a esta empresa na Drap. Entre com ele.",
          );
        }
        throw new ApiError(502, "drap_recusou", cause.detalhe);
      }
      throw cause;
    }

    await context.db.batch([
      auditStatement(context, "integration.drap_conta_solicitada", "integration_connection", connection.id, {
        // Sem o link: ele é credencial de acesso de administrador enquanto vale, e
        // auditoria é lida por mais gente do que quem pode usá-lo.
        externalCompanyId: connection.external_company_id,
        emailEnviado: convite.emailEnviado,
      }),
    ]);

    return Response.json({
      // O link volta porque e-mail falha — cai no spam, o domínio recusa, o SMTP está
      // fora. `emailEnviado: false` é o sinal para a tela mostrar o link em vez de
      // mandar a pessoa esperar uma mensagem que pode não vir.
      link: convite.link,
      expiraEm: convite.expiraEm,
      emailEnviado: convite.emailEnviado,
      email: context.user.email,
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
