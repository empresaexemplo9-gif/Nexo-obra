import { z } from "zod";

import { DrapApiError, requestDrapApi } from "@/lib/integrations/drap";
import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { requireActiveDrapConnection } from "@/lib/server/drap";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

/**
 * Cadastro fiscal da empresa — o que a prefeitura exige para aceitar uma nota dela.
 *
 * ─── O QUE ATRAVESSA AQUI ───
 *
 * O certificado A1 e a senha dele. É a chave privada de assinatura fiscal da empresa:
 * quem a tem assina documento em nome dela.
 *
 * A H.OIKOS NÃO guarda nenhum dos dois. Eles entram no corpo, seguem para o serviço
 * fiscal e acabam ali. Não há coluna, não há cache, não há log — nem o nome do arquivo.
 * O que volta na leitura é o cadastro sem segredo nenhum.
 *
 * ─── POR QUE O SCHEMA É REPETIDO AQUI ───
 *
 * O serviço valida de novo, e é ele quem manda. Mas deixar o corpo passar direto
 * transformaria a plataforma num encaminhador cego: erro de digitação viraria mensagem
 * de outro produto, com vocabulário de outro produto, na tela de quem nunca ouviu falar
 * dele. Validar aqui é o que permite dizer "CEP tem 8 dígitos" em vez de repassar o que
 * vier.
 */
const numeroOpcional = z.number().finite().optional().nullable();

const cadastroSchema = z.object({
  tipo_prestador: z.enum(["pj", "autonomo"]).default("pj"),
  cnpj: z.string().trim().max(20).optional().nullable(),
  cpf: z.string().trim().max(20).optional().nullable(),
  razao_social: z.string().trim().min(2, "Razão social ou nome completo é obrigatório.").max(200),
  nome_fantasia: z.string().trim().max(200).optional().nullable(),
  inscricao_municipal: z.string().trim().min(1, "Inscrição municipal é obrigatória.").max(20),
  codigo_municipio: z.string().trim().regex(/^\d{7}$/, "O código IBGE do município tem 7 dígitos."),
  municipio: z.string().trim().min(2, "Município é obrigatório.").max(100),
  uf: z.string().trim().length(2, "UF tem 2 letras."),
  cep: z.string().trim().regex(/^\d{8}$/, "CEP tem 8 dígitos, só números."),
  logradouro: z.string().trim().min(1, "Logradouro é obrigatório.").max(200),
  numero: z.string().trim().min(1, "Número é obrigatório.").max(20),
  complemento: z.string().trim().max(100).optional().nullable(),
  bairro: z.string().trim().min(1, "Bairro é obrigatório.").max(100),
  email: z.string().trim().email("E-mail inválido.").max(200),
  telefone: z.string().trim().max(30).optional().nullable(),
  enquadramento_fiscal: z.enum(["nao_optante", "mei", "me_epp"]).optional().nullable(),
  aliquota_iss: numeroOpcional,
  item_lista_servico: z.string().trim().max(10).optional().nullable(),
  codigo_tributario_municipio: z.string().trim().max(30).optional().nullable(),
  codigo_cnae: z.string().trim().max(10).optional().nullable(),
  discriminacao_padrao: z.string().trim().max(1000).optional().nullable(),
  // Opcional no update: quem já cadastrou não reenvia o certificado para corrigir o
  // bairro. No primeiro cadastro o serviço recusa sem ele, com mensagem própria.
  certificado_base64: z.string().max(4_000_000).optional().nullable(),
  certificado_senha: z.string().max(200).optional().nullable(),
  ambiente: z.enum(["homologacao", "producao"]).default("homologacao"),
  aceite_producao: z.boolean().optional(),
  aceite_producao_responsavel: z.string().trim().max(200).optional(),
}).strict();

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const connection = await requireActiveDrapConnection(context);

    try {
      const { data } = await requestDrapApi<{ config: unknown; ambiente_default?: string }>(
        connection.external_company_id,
        "/api/v1/nfse/config",
      );
      return Response.json({
        config: data?.config ?? null,
        ambienteDefault: data?.ambiente_default ?? "homologacao",
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (cause) {
      throw traduzir(cause);
    }
  });
}

export async function PUT(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    // Dado fiscal da empresa e o certificado dela: decisão de quem responde pela
    // empresa, não operação do dia.
    const context = await requireOrganizationContext(request, ["owner", "admin"]);
    requireModulePermission(context, "finance", "edit");
    const connection = await requireActiveDrapConnection(context);

    const parsed = cadastroSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);

    let config: unknown = null;
    try {
      const resposta = await requestDrapApi<{ config: unknown }>(
        connection.external_company_id,
        "/api/v1/nfse/config",
        { method: "PUT", body: parsed.data },
      );
      config = resposta.data?.config ?? null;
    } catch (cause) {
      throw traduzir(cause);
    }

    await context.db.batch([
      auditStatement(context, "integration.drap_nfse_config", "integration_connection", connection.id, {
        // Nunca o certificado nem a senha. `certificadoEnviado` responde "trocaram a
        // credencial nesta edição?" sem guardar nada de credencial.
        externalCompanyId: connection.external_company_id,
        ambiente: parsed.data.ambiente,
        certificadoEnviado: Boolean(parsed.data.certificado_base64),
      }),
    ]);

    return Response.json({ config }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/**
 * Traduz a recusa do serviço fiscal sem apagá-la.
 *
 * O motivo vem de lá e costuma ser acionável — "município exige CNAE", "certificado
 * vencido", "aguardando liberação". Trocar isso por "erro ao salvar" obrigaria a pessoa
 * a abrir um chamado para descobrir o que ela mesma corrigiria em trinta segundos.
 */
function traduzir(cause: unknown): unknown {
  if (!(cause instanceof DrapApiError)) return cause;
  const corpo = cause.detail as { error?: string; message?: string; detail?: string } | null;
  const motivo = corpo?.message ?? corpo?.detail ?? corpo?.error ?? null;

  if (cause.status === 403 && corpo?.error === "emissao-nao-liberada") {
    return new ApiError(409, "emissao_nao_liberada", motivo ?? "A emissão de nota fiscal ainda não foi liberada para esta empresa.");
  }
  if (cause.status === 403) {
    return new ApiError(409, "sem_emissao_no_plano", "Emissão de nota fiscal não está incluída no plano desta empresa.");
  }
  if (cause.status === 412) {
    return new ApiError(412, "aceite_producao_required", motivo ?? "Para emitir com valor fiscal real, é preciso aceitar os termos de produção.");
  }
  if (cause.status === 422 || cause.status === 400) {
    return new ApiError(422, "cadastro_recusado", motivo ?? "O cadastro fiscal foi recusado. Confira os dados.");
  }
  return new ApiError(502, "servico_fiscal_indisponivel", "Não foi possível falar com o serviço fiscal agora.");
}
