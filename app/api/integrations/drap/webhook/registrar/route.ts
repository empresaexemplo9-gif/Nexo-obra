import { ApiError, apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { conectarWebhook } from "@/lib/server/drap-webhook-conectar";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

// Nova tentativa de registrar o webhook desta empresa na Drap.
//
// Conectar já tenta sozinho. Esta rota existe para o que sobra: a Drap estava fora do ar
// naquele instante, ou a instalação ainda não tinha `HOIKOS_PUBLIC_URL`, ou a empresa foi
// conectada antes de a plataforma passar a registrar. Em todos esses casos a conexão
// funciona e só falta o aviso automático — e obrigar a desconectar e conectar de novo só
// para isso seria desfazer o que está certo para consertar o que falta.
//
// Não recebe corpo: a empresa vem da sessão, nunca do navegador. Aceitar um
// `externalCompanyId` daqui deixaria um administrador de uma organização registrar webhook
// para a empresa de outra.

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");

    const conexao = await context.db.prepare(
      "SELECT external_company_id, webhook_secret_encrypted FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1",
    ).bind(context.organization.id).first<{ external_company_id: string; webhook_secret_encrypted: string | null }>();

    if (!conexao) {
      throw new ApiError(409, "sem_conexao", "Conecte esta empresa à Drap antes de registrar o webhook.");
    }
    if (conexao.webhook_secret_encrypted) {
      // Já registrado. Repetir criaria uma segunda assinatura para a mesma URL na Drap, e
      // cada evento passaria a chegar em dobro.
      return Response.json(
        { webhook: { registrado: true } },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const webhook = await conectarWebhook(context, conexao.external_company_id);
    if (!webhook.ok) {
      // O motivo vem da Drap ou da configuração e é acionável: falta escopo na chave,
      // falta a URL pública, já existe assinatura para este endereço. Trocar por um texto
      // genérico esconderia o que fazer.
      throw new ApiError(502, webhook.codigo, webhook.motivo);
    }

    return Response.json(
      { webhook: { registrado: true } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
