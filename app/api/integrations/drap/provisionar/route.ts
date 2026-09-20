import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { DrapPartnerError, isDrapPartnerConfigured, provisionarEmpresaNaDrap, vincularEmpresaNaDrap } from "@/lib/integrations/drap-partner";
import { instrucoesParaGuardarCredenciais } from "@/lib/server/drap-credenciais";
import { guardaDeSegredosConfigurada } from "@/lib/server/segredos";
import { conectarWebhook } from "@/lib/server/drap-webhook-conectar";

export const dynamic = "force-dynamic";

// Liga esta empresa à Drap sem ninguém sair da H.OIKOS.
//
// Dois caminhos, e a diferença entre eles é quem consente:
//
//   provisionar — a empresa não existe na Drap. A plataforma cria e recebe a chave.
//   vincular    — a empresa JÁ existe lá. Só o ADMIN dela pode autorizar, e autoriza
//                 gerando um código dentro da Drap. Sem esse código, saber o CNPJ de
//                 alguém bastaria para passar a operar o financeiro dele.
//
// A chave volta uma vez só, na resposta da Drap. Ela é cifrada e guardada aqui mesmo —
// nunca chega ao navegador, nunca aparece em log, nunca vai para variável de ambiente.
//
// Conectar também registra o webhook desta empresa na Drap, para a plataforma saber de
// mudança sem ficar perguntando. O segredo dessa assinatura segue o mesmo caminho da
// chave: resposta da Drap, cifra, banco.

const corpoSchema = z.discriminatedUnion("modo", [
  z.object({
    modo: z.literal("provisionar"),
    documentoTipo: z.enum(["cpf", "cnpj"]),
    // Só dígitos: 11 (CPF) ou 14 (CNPJ). É o documento que impede empresa duplicada na
    // Drap, e o 409 que ele gera é o que manda para o caminho do vínculo.
    documentoNumero: z.string().trim().regex(/^\d{11}$|^\d{14}$/, "Informe CPF (11 dígitos) ou CNPJ (14 dígitos), só números."),
  }),
  z.object({
    modo: z.literal("vincular"),
    codigo: z.string().trim().min(6).max(16),
  }),
]);

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");

    if (!isDrapPartnerConfigured()) {
      return Response.json(
        { error: "A conexão automática com a Drap não está configurada nesta instalação.", code: "drap_partner_not_configured" },
        { status: 503 },
      );
    }
    // Checado ANTES de falar com a Drap: sem onde guardar a chave, provisionar criaria
    // uma empresa lá que ninguém aqui consegue operar — e o documento único impediria
    // criar de novo.
    if (!guardaDeSegredosConfigurada()) {
      return Response.json(
        { error: "A guarda de credenciais não está configurada nesta instalação.", code: "secrets_unavailable" },
        { status: 503 },
      );
    }

    const parsed = corpoSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const dados = parsed.data;

    const existente = await context.db.prepare(
      "SELECT id, external_company_id, api_token_encrypted FROM integration_connections WHERE organization_id = ?1 AND provider = 'drap' LIMIT 1",
    ).bind(context.organization.id).first<{ id: string; external_company_id: string; api_token_encrypted: string | null }>();

    if (existente?.api_token_encrypted) {
      throw new ApiError(409, "ja_conectada", "Esta empresa já está conectada à Drap. Desconecte antes de conectar de novo.");
    }

    // A referência externa é a organização, não o pedido: é ela que faz a Drap devolver a
    // MESMA empresa se isto rodar duas vezes.
    //
    // A chave de idempotência é DERIVADA da organização, não sorteada: a regra 5 do
    // CLAUDE.md pede reutilizar a mesma chave no retry, e sortear uma nova a cada clique
    // faria exatamente o contrário — cada tentativa pareceria um pedido novo para a Drap.
    const idempotencyKey = `hoikos:${context.organization.id}:${dados.modo}`;
    const id = existente?.id ?? crypto.randomUUID();

    let empresaId: string;
    let chave: string | null;
    let origem: "provisionado" | "vinculado";

    try {
      if (dados.modo === "provisionar") {
        const empresa = await provisionarEmpresaNaDrap({
          nome: context.organization.name,
          documentoTipo: dados.documentoTipo,
          documentoNumero: dados.documentoNumero,
          externalRef: context.organization.id,
          idempotencyKey,
        });
        empresaId = empresa.tenantId;
        chave = empresa.chave;
        origem = "provisionado";

        // Repetição sem chave e sem nada guardado: a empresa existe na Drap, mas a chave
        // dela se perdeu. Dizer isso é melhor do que gravar uma conexão que não opera.
        if (!chave) {
          throw new ApiError(
            409,
            "chave_nao_devolvida",
            "A Drap reconheceu esta empresa de um pedido anterior e não mostra a chave duas vezes. Peça uma nova chave ao administrador da Drap.",
          );
        }
      } else {
        const vinculo = await vincularEmpresaNaDrap({
          codigo: dados.codigo,
          externalRef: context.organization.id,
          idempotencyKey,
        });
        empresaId = vinculo.tenantId;
        chave = vinculo.chave;
        origem = "vinculado";
      }
    } catch (causa) {
      if (causa instanceof ApiError) throw causa;
      if (causa instanceof DrapPartnerError) {
        // O motivo vem da Drap e é acionável: documento já cadastrado, código vencido,
        // módulo faltando. Trocar por uma mensagem genérica aqui esconderia o que fazer.
        const status = causa.status === 409 || causa.status === 403 ? causa.status : 502;
        throw new ApiError(status, causa.codigo, causa.detalhe);
      }
      throw new ApiError(502, "drap_unavailable", "A Drap não respondeu. Nenhuma empresa foi criada por esta tentativa.");
    }

    await context.db.batch([
      await instrucoesParaGuardarCredenciais({
        db: context.db,
        id,
        organizationId: context.organization.id,
        externalCompanyId: empresaId,
        token: chave,
        origem,
      }),
      auditStatement(context, origem === "provisionado" ? "integration.drap_provisionada" : "integration.drap_vinculada", "integration_connection", id, {
        // O id da empresa na Drap entra na auditoria; a chave, nunca.
        externalCompanyId: empresaId,
      }),
    ]);

    // Registrar o webhook DEPOIS de a conexão existir, e nunca antes: registrar primeiro
    // deixaria, numa falha de gravação, uma assinatura viva na Drap apontando para cá sem
    // nada aqui capaz de reconhecê-la.
    //
    // A falha não derruba a conexão — ela é dita. Sem webhook a plataforma continua
    // operando a empresa, só volta a depender de consulta para saber de mudança; chamar
    // isso de erro mandaria o usuário desfazer o que acabou de dar certo.
    const webhook = await conectarWebhook(context, empresaId);

    return Response.json(
      {
        connection: { id, externalCompanyId: empresaId, status: "active", origem },
        webhook: webhook.ok
          ? { registrado: true }
          : { registrado: false, codigo: webhook.codigo, motivo: webhook.motivo },
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
