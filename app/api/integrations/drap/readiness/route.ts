import { apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";
import { runtimeEnv } from "@/lib/server/runtime";
import { guardaDeSegredosConfigurada } from "@/lib/server/segredos";
import { hasDrapTenantCredential, getDrapWebhookCandidates } from "@/lib/integrations/drap";
import { isDrapPartnerConfigured } from "@/lib/integrations/drap-partner";
import { segredoDeWebhookGuardado } from "@/lib/server/drap-credenciais";
import { urlDoReceptor } from "@/lib/server/drap-webhook-registro";
import { activationFor, activationConfigured } from "@/lib/server/activation";
import { probeDrapResources } from "@/lib/server/drap-resources";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "view");
    const env = runtimeEnv();
    const connection = await context.db.prepare("SELECT external_company_id, status FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap'")
      .bind(context.organization.id).first<{ external_company_id: string; status: string }>();
    const activation = await activationFor(context.organization.id);
    const credential = connection ? await hasDrapTenantCredential(connection.external_company_id) : false;
    const globalCandidates = getDrapWebhookCandidates();
    const totalConnections = await context.db.prepare("SELECT COUNT(*) n FROM integration_connections WHERE provider = 'drap' AND status = 'active'").first<{ n: number }>();
    const webhook = Boolean(connection && (await segredoDeWebhookGuardado(connection.external_company_id) || globalCandidates.some(candidate => candidate.externalCompanyId === connection.external_company_id || (!candidate.externalCompanyId && totalConnections?.n === 1))));
    let apiUrlValid = false;
    try { const url = new URL(env.DRAP_API_URL ?? ""); apiUrlValid = url.protocol === "https:" && !url.username && !url.password; } catch { /* diagnostic only */ }
    let activationUrlValid = false;
    try { const url = new URL(env.DRAP_ACTIVATION_URL ?? ""); activationUrlValid = url.protocol === "https:" && url.hostname === "empresa.drap.app.br" && !url.username && !url.password; } catch { /* diagnostic only */ }
    const checks = [
      { id: "api", label: "Endereço HTTPS da API Drap", ready: apiUrlValid, next: "A operadora deve configurar o endereço oficial fornecido pela Drap." },
      { id: "partner", label: "Provisionamento por parceiro", ready: isDrapPartnerConfigured(), next: "Aguardar a configuração de parceria pela Drap e pela operadora H.OIKOS." },
      { id: "encryption", label: "Proteção das credenciais", ready: guardaDeSegredosConfigurada(), next: "A operadora deve configurar a chave de criptografia no servidor." },
      { id: "callback", label: "Endereço de recebimento de eventos", ready: Boolean(urlDoReceptor()), next: "Configurar o domínio público HTTPS definitivo da H.OIKOS." },
      { id: "tenant", label: "Empresa vinculada com credencial", ready: Boolean(connection?.status === "active" && credential), next: "Criar ou vincular a conta desta empresa e validar a credencial." },
      { id: "webhook", label: "Credencial de webhook desta empresa", ready: webhook, next: "Registrar o webhook em Conexão Drap e confirmar uma entrega válida." },
      { id: "checkout", label: "Configuração da contratação integrada", ready: activationConfigured() && activationUrlValid, next: "Aguardar o contrato de contratação e a configuração final da Drap." },
      { id: "subscription", label: "Assinatura confirmada pela Drap", ready: activation?.status === "active", next: "Aguardar confirmação da assinatura, quando houver serviço pago contratado." },
    ];
    // A consulta padrão só inspeciona configuração local. A verificação explícita usa GET.
    const verifyApi = new URL(request.url).searchParams.get("verifyApi") === "1";
    const resources = verifyApi && connection?.status === "active" && credential && apiUrlValid
      ? await probeDrapResources(connection.external_company_id, true) : null;
    const events = await context.db.prepare("SELECT status, COUNT(*) count FROM integration_events WHERE organization_id = ?1 AND provider = 'drap' GROUP BY status").bind(context.organization.id).all<{ status: string; count: number }>();
    return Response.json({ checkedAt: new Date().toISOString(), checks, resources, events: events.results,
      canVerifyApi: Boolean(connection?.status === "active" && credential && apiUrlValid),
      operationallyValidated: false,
      notice: "Configuração e consulta não comprovam contratação, pagamento, cancelamento ou emissão fiscal. A homologação conjunta com a Drap continua necessária.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
