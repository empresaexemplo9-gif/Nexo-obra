import { auditStatement, type OrganizationContext } from "@/lib/server/backend";
import { tokenGuardado, instrucoesParaGuardarSegredoDeWebhook } from "@/lib/server/drap-credenciais";
import { registrarWebhookNaDrap, type RegistroResultado } from "@/lib/server/drap-webhook-registro";

// O passo que transforma "empresa conectada" em "empresa que avisa quando muda".
//
// Fica separado da rota de conexão porque acontece em dois momentos: logo depois de
// conectar, e de novo quando o administrador manda tentar outra vez — uma falha aqui não
// desfaz a conexão, ela só deixa a plataforma sem notificação automática até alguém
// reagir. Ter um lugar só evita que os dois caminhos divirjam no que gravam ou auditam.

export type ConectarWebhookResultado =
  | { ok: true; url: string }
  | { ok: false; codigo: string; motivo: string };

/**
 * Registra o webhook desta empresa na Drap e guarda o segredo, cifrado.
 *
 * Não lança. A conexão com a Drap continua válida sem webhook: perde-se o aviso
 * automático, não o acesso — e apresentar a conexão inteira como falha por causa disso
 * mandaria o usuário desfazer algo que está funcionando.
 *
 * O segredo nunca sai desta camada: entra cifrado no banco e só é lido pelo receptor,
 * para conferir assinatura. Nem a auditoria nem a resposta HTTP o mencionam.
 */
export async function conectarWebhook(
  context: OrganizationContext,
  externalCompanyId: string,
): Promise<ConectarWebhookResultado> {
  const token = await tokenGuardado(externalCompanyId);
  if (!token) {
    // Sem a chave da empresa não há como falar com a Drap por ela. Acontece quando a
    // conexão foi feita à mão por variável de ambiente: ali o segredo do webhook também
    // é colado à mão, e não há o que registrar.
    return {
      ok: false,
      codigo: "sem-credencial-guardada",
      motivo: "Esta empresa não tem credencial guardada aqui. Conecte-a pela plataforma ou configure o segredo do webhook no painel de publicação.",
    };
  }

  const registro: RegistroResultado = await registrarWebhookNaDrap(token);
  if (!registro.ok) return registro;

  await context.db.batch([
    await instrucoesParaGuardarSegredoDeWebhook({
      db: context.db,
      organizationId: context.organization.id,
      webhookSecret: registro.segredo,
    }),
    auditStatement(context, "integration.drap_webhook_registrado", "integration_connection", externalCompanyId, {
      // A URL entra na auditoria de propósito: webhook é desvio de dado, e quem audita
      // precisa ver para onde. O segredo, nunca.
      url: registro.url,
    }),
  ]);

  return { ok: true, url: registro.url };
}
