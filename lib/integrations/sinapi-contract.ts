import { z } from "zod";

export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const mappingSchema = z.object({
  aba: z.string().min(1).max(100), tipo: z.enum(["insumo", "composicao"]),
  cabecalho: z.number().int().min(1).max(30),
  codigo: z.number().int().min(0).max(200), descricao: z.number().int().min(0).max(200),
  unidade: z.number().int().min(0).max(200), preco: z.number().int().min(0).max(200),
}).strict().refine((v) => new Set([v.codigo, v.descricao, v.unidade, v.preco]).size === 4, "As colunas devem ser diferentes.");
export type Mapping = z.infer<typeof mappingSchema>;
export type Profile = { uf: string; regime: "Desonerado" | "NaoDesonerado"; automatico: boolean; mapas: Mapping[]; assinaturas: string[] };
export function sourceUrl(month: string) {
  return `https://www.caixa.gov.br/Downloads/sinapi-relatorios-mensais/SINAPI-${monthSchema.parse(month)}-formato-xlsx.zip`;
}
export function previousMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}
export function columnName(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
