import { z } from "zod";

export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export const DEFAULT_SINAPI_UF = "GO";
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const regimeSchema = z.enum(["Desonerado", "NaoDesonerado"]);
export const mappingSchema = z.object({
  aba: z.string().min(1).max(100), tipo: z.enum(["insumo", "composicao"]),
  cabecalho: z.number().int().min(1).max(30),
  codigo: z.number().int().min(0).max(200), descricao: z.number().int().min(0).max(200),
  unidade: z.number().int().min(0).max(200), preco: z.number().int().min(0).max(200),
}).strict().refine((v) => new Set([v.codigo, v.descricao, v.unidade, v.preco]).size === 4, "As colunas devem ser diferentes.");
export type Mapping = z.infer<typeof mappingSchema>;
export type SinapiRegime = z.infer<typeof regimeSchema>;
export type Profile = { uf: string; regime: SinapiRegime; automatico: boolean; mapas: Mapping[]; assinaturas: string[] };

export function normalizeSinapiUf(value: string) {
  const uf = value.trim().toUpperCase();
  if (!UFS.includes(uf)) throw new Error(`UF SINAPI inválida: ${value}.`);
  return uf;
}

export function normalizeReferenceMonth(value: string) {
  return monthSchema.parse(value.trim());
}

export function referenceDate(value: string) {
  return `${normalizeReferenceMonth(value)}-01`;
}

export function apiRegime(regime: SinapiRegime) {
  return regime === "Desonerado" ? "DESONERADO" : "NAO_DESONERADO";
}

export function isLegacyCaixaReference(month: string) {
  return normalizeReferenceMonth(month) < "2025-01";
}

export function sourceUrl(month: string) {
  const reference = normalizeReferenceMonth(month);
  if (isLegacyCaixaReference(reference)) {
    throw new Error("Referências SINAPI até 2024 usam arquivos históricos por UF e regime, com nomenclatura variável. Use o envio manual do ZIP oficial da CAIXA para evitar uma URL incorreta.");
  }
  return `https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-${reference}-formato-xlsx.zip`;
}

export function previousMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}
export function columnName(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
