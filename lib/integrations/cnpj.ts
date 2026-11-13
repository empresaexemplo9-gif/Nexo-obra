import { z } from "zod";

// Consulta de CNPJ nos dados abertos da Receita Federal, pela BrasilAPI.
//
// Só o servidor chama: o que a tela recebe é o que a Receita respondeu, e o "verificado"
// do fornecedor nunca vem do navegador. Falha, CNPJ inexistente ou limite de consultas
// voltam como erro — nunca como cadastro preenchido com suposição.

export const CNPJ_API = "https://brasilapi.com.br/api/cnpj/v1/";

export function cnpjValido(valor: string): boolean {
  const d = valor.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const resto = base.split("").reduce((soma, n, i) => soma + Number(n) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(d.slice(0, 12)) === Number(d[12]) && digito(d.slice(0, 13)) === Number(d[13]);
}

const texto = z.string().nullish().transform((v) => (v ?? "").trim());
const resposta = z.object({
  cnpj: z.string(),
  razao_social: z.string().min(1),
  nome_fantasia: texto,
  descricao_situacao_cadastral: texto,
  cnae_fiscal_descricao: texto,
  municipio: texto,
  uf: texto,
  ddd_telefone_1: texto,
  email: texto,
}).passthrough();

export type DadosDaReceita = {
  cnpj: string; razaoSocial: string; nomeFantasia: string; situacao: string; atividade: string;
  municipio: string; uf: string; telefone: string; email: string;
};

export class FalhaNaConsulta extends Error {
  constructor(public motivo: "invalido" | "inexistente" | "indisponivel" | "incompativel", mensagem: string) { super(mensagem); }
}

function formatarTelefone(bruto: string) {
  const d = bruto.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return bruto;
}

const titulo = (t: string) => t.toLocaleLowerCase("pt-BR").replace(/(^|\s)(\p{L})/gu, (_, espaco, letra) => espaco + letra.toLocaleUpperCase("pt-BR"));

export async function consultarCnpj(cnpj: string, buscar: typeof fetch = fetch): Promise<DadosDaReceita> {
  const digitos = cnpj.replace(/\D/g, "");
  if (!cnpjValido(digitos)) throw new FalhaNaConsulta("invalido", "CNPJ inválido: confira os dígitos.");
  let resposta_: Response;
  try {
    resposta_ = await buscar(`${CNPJ_API}${digitos}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
  } catch {
    throw new FalhaNaConsulta("indisponivel", "A consulta à Receita não respondeu. Tente de novo em instantes.");
  }
  if (resposta_.status === 404) throw new FalhaNaConsulta("inexistente", "Este CNPJ não consta na base da Receita Federal.");
  if (!resposta_.ok) throw new FalhaNaConsulta("indisponivel", resposta_.status === 429 ? "Limite de consultas à Receita atingido. Tente em alguns minutos." : "A consulta à Receita está indisponível agora.");
  const lido = resposta.safeParse(await resposta_.json().catch(() => null));
  if (!lido.success || lido.data.cnpj.replace(/\D/g, "") !== digitos) throw new FalhaNaConsulta("incompativel", "A resposta da consulta veio em formato inesperado; nada foi preenchido.");
  const d = lido.data;
  return {
    cnpj: digitos, razaoSocial: d.razao_social.trim(), nomeFantasia: d.nome_fantasia, situacao: d.descricao_situacao_cadastral.toUpperCase(),
    atividade: d.cnae_fiscal_descricao, municipio: d.municipio ? titulo(d.municipio) : "", uf: d.uf.toUpperCase(),
    telefone: d.ddd_telefone_1 ? formatarTelefone(d.ddd_telefone_1) : "", email: d.email.toLowerCase(),
  };
}
