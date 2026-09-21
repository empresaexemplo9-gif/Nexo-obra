import { runtimeEnv as platformEnv } from "@/lib/server/runtime";
import { ESCOPOS_DA_PLATAFORMA } from "@/lib/server/drap-webhook-registro";

// Cliente da API de PARCEIRO da Drap — a que cria empresa e emite a chave dela.
//
// Duas credenciais, de propósito, e a separação é o ponto: `DRAP_PARTNER_TOKEN` provisiona
// e não lê nada de negócio; a `drap_live_…` que ele devolve opera dentro de UMA empresa.
// Uma credencial só para as duas coisas seria uma chave que lê o financeiro de toda a
// carteira. O dia em que ela vazar decide se o estrago é reversível.
//
// Este módulo é servidor puro. O token de parceiro nunca chega ao navegador — nem ele nem
// a chave da empresa, que sai daqui direto para a cifra do banco.

type DrapPartnerEnv = {
  DRAP_API_URL?: string;
  DRAP_PARTNER_TOKEN?: string;
};

function env() {
  return platformEnv() as unknown as DrapPartnerEnv;
}

export function isDrapPartnerConfigured() {
  const config = env();
  return Boolean(config.DRAP_API_URL && config.DRAP_PARTNER_TOKEN);
}

function url(caminho: string) {
  const base = env().DRAP_API_URL;
  if (!base) throw new Error("DRAP partner API is not configured");
  return new URL(caminho.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
}

function headers(idempotencyKey?: string) {
  const token = env().DRAP_PARTNER_TOKEN;
  if (!token) throw new Error("DRAP partner API is not configured");
  const h = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  });
  if (idempotencyKey) h.set("Idempotency-Key", idempotencyKey);
  return h;
}

export class DrapPartnerError extends Error {
  constructor(public status: number, public codigo: string, public detalhe: string) {
    super(`DRAP partner request failed with status ${status}: ${codigo}`);
  }
}

function texto(valor: unknown, padrao: string) {
  return typeof valor === "string" && valor ? valor : padrao;
}

async function chamar(caminho: string, corpo: unknown, idempotencyKey?: string) {
  const resposta = await fetch(url(caminho), {
    method: "POST",
    redirect: "error",
    headers: headers(idempotencyKey),
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15000),
  });

  const bruto = resposta.status === 204 ? "" : await resposta.text();
  let dados: Record<string, unknown> = {};
  if (bruto) {
    try { dados = JSON.parse(bruto) as Record<string, unknown>; }
    catch { dados = { error: bruto.slice(0, 200) }; }
  }

  if (!resposta.ok) {
    throw new DrapPartnerError(
      resposta.status,
      texto(dados.error, "erro-desconhecido"),
      texto(dados.detail, "A Drap recusou a solicitação."),
    );
  }
  return dados;
}

export type EmpresaProvisionada = {
  /** Id da empresa na Drap. É ele que vai em `external_company_id`. */
  tenantId: string;
  slug: string;
  /** `null` quando o pedido foi repetição: a Drap não mostra a chave duas vezes. */
  chave: string | null;
  reaproveitado: boolean;
};

/**
 * Cria a empresa na Drap e recebe a chave de operação dela.
 *
 * `externalRef` é o id da organização aqui — é por ele que a Drap reconhece um pedido
 * repetido e devolve a mesma empresa em vez de criar a segunda. `idempotencyKey` cobre o
 * caso mais estreito e mais provável: a resposta se perdeu no caminho e o cliente repetiu.
 */
export async function provisionarEmpresaNaDrap(entrada: {
  nome: string;
  documentoTipo: "cpf" | "cnpj" | null;
  documentoNumero: string | null;
  externalRef: string;
  idempotencyKey: string;
  escopos?: string[];
}): Promise<EmpresaProvisionada> {
  const dados = await chamar("/api/partner/v1/empresas", {
    nome: entrada.nome,
    documento_tipo: entrada.documentoTipo,
    documento_numero: entrada.documentoNumero,
    external_ref: entrada.externalRef,
    // Pedidos sempre, não deixados no padrão da Drap: o padrão dela não inclui
    // `webhooks:*`, e sem esse escopo a empresa nasce sem poder registrar o próprio
    // webhook — que é o que faz a plataforma saber de mudança sem ficar perguntando.
    escopos: entrada.escopos ?? [...ESCOPOS_DA_PLATAFORMA],
  }, entrada.idempotencyKey);

  const empresa = (dados.empresa ?? {}) as Record<string, unknown>;
  const tenantId = texto(empresa.id, "");
  if (!tenantId) throw new DrapPartnerError(502, "resposta-sem-empresa", "A Drap respondeu sem o id da empresa.");

  return {
    tenantId,
    slug: texto(empresa.slug, ""),
    chave: typeof dados.chave === "string" && dados.chave ? dados.chave : null,
    reaproveitado: dados.reaproveitado === true,
  };
}

/**
 * Vincula uma empresa que JÁ existe na Drap, usando o código que o admin dela gerou lá
 * dentro. O código é a única prova de consentimento — sem ele, saber o CNPJ de alguém
 * bastaria para passar a operar o financeiro dele.
 */
export async function vincularEmpresaNaDrap(entrada: {
  codigo: string;
  externalRef: string;
  idempotencyKey: string;
  escopos?: string[];
}): Promise<{ tenantId: string; chave: string }> {
  const dados = await chamar("/api/partner/v1/vinculos", {
    codigo: entrada.codigo,
    external_ref: entrada.externalRef,
    escopos: entrada.escopos ?? [...ESCOPOS_DA_PLATAFORMA],
  }, entrada.idempotencyKey);

  const empresa = (dados.empresa ?? {}) as Record<string, unknown>;
  const tenantId = texto(empresa.id, "");
  const chave = texto(dados.chave, "");
  if (!tenantId || !chave) {
    throw new DrapPartnerError(502, "resposta-incompleta", "A Drap respondeu sem empresa ou sem chave.");
  }
  return { tenantId, chave };
}

/** Emite outra chave para uma empresa já vinculada. Serve para quando a chave guardada
 *  não abre mais — chave perdida não pode obrigar a recriar a empresa. */
export async function emitirChaveNaDrap(tenantId: string, escopos?: string[]): Promise<string> {
  const dados = await chamar(`/api/partner/v1/empresas/${encodeURIComponent(tenantId)}/chaves`, {
    escopos: escopos ?? [...ESCOPOS_DA_PLATAFORMA],
  });
  const chave = texto(dados.chave, "");
  if (!chave) throw new DrapPartnerError(502, "resposta-sem-chave", "A Drap respondeu sem a chave.");
  return chave;
}

/**
 * Apaga na Drap uma empresa que a plataforma criou lá.
 *
 * A Drap só aceita apagar empresa que este parceiro PROVISIONOU. Uma empresa que já
 * existia e foi vinculada pelo administrador dela é recusada de lá mesmo: o dono
 * consentiu que a plataforma operasse o financeiro, e operar não é destruir.
 *
 * Devolve o motivo da recusa em vez de engolir: "empresa com gente dentro" e "empresa
 * vinculada" são coisas que quem está apagando precisa ler, porque mudam a decisão.
 */
export async function apagarEmpresaNaDrap(tenantId: string): Promise<void> {
  const resposta = await fetch(url(`/api/partner/v1/empresas/${encodeURIComponent(tenantId)}`), {
    method: "DELETE",
    redirect: "error",
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  });

  if (resposta.ok) return;

  const bruto = resposta.status === 204 ? "" : await resposta.text();
  let dados: Record<string, unknown> = {};
  if (bruto) {
    try { dados = JSON.parse(bruto) as Record<string, unknown>; }
    catch { dados = { error: bruto.slice(0, 200) }; }
  }
  throw new DrapPartnerError(
    resposta.status,
    texto(dados.error, "erro-desconhecido"),
    texto(dados.detail, "A Drap recusou apagar a empresa."),
  );
}
