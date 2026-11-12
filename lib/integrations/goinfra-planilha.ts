import { z } from "zod";

import { abrirPlanilha } from "./planilha-xlsx";
import { paraCentavos } from "./sinapi-planilha";

// Interpretação da tabela de preços da GOINFRA (Agência Goiana de Infraestrutura e
// Transportes).
//
// A agência publica a tabela no próprio site, em planilha, por referência mensal e com
// versões com e sem desoneração. Não há API: o superadministrador baixa o arquivo oficial
// e envia aqui. Pela mesma razão da SINAPI, as colunas são achadas pelo NOME no
// cabeçalho, nunca pela posição — uma coluna lida no lugar errado vira preço errado em
// silêncio, e isso é pior do que recusar o arquivo.

export const TABELAS_GOINFRA = ["obras-civis", "rodoviaria"] as const;
export type TabelaGoinfra = typeof TABELAS_GOINFRA[number];
export const rotuloTabelaGoinfra: Record<TabelaGoinfra, string> = { "obras-civis": "Obras civis", rodoviaria: "Rodoviária" };
export const REGIMES_GOINFRA = ["Desonerado", "NaoDesonerado"] as const;
export const rotuloRegimeGoinfra: Record<typeof REGIMES_GOINFRA[number], string> = { Desonerado: "Desonerada", NaoDesonerado: "Não desonerada" };

export const envioGoinfraSchema = z.object({
  referencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a referência no formato AAAA-MM."),
  tabela: z.enum(TABELAS_GOINFRA),
  regime: z.enum(REGIMES_GOINFRA),
});

export type ItemGoinfra = { codigo: string; descricao: string; unidade: string; custoUnitarioCentavos: number };
export type InterpretacaoGoinfra = { itens: ItemGoinfra[]; aba: string; linhaDoCabecalho: number; ignoradas: number };

const SINONIMOS: Record<"codigo" | "descricao" | "unidade" | "preco", string[]> = {
  codigo: ["codigo", "cod", "item", "codigo goinfra", "codigo do servico", "codigo do insumo"],
  descricao: ["descricao", "descricao do servico", "descricao do insumo", "discriminacao", "servico", "especificacao"],
  unidade: ["unidade", "und", "un", "unid"],
  preco: ["preco unitario", "custo unitario", "valor unitario", "preco total", "custo total", "preco", "custo", "valor"],
};

// Acento, caixa, pontuação e espaço repetido não podem decidir se a coluna é achada:
// "UNID." e "Preço Unitário (R$)" precisam casar com "unid" e "preco unitario".
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(r\$\)|r\$/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function acharColunas(linha: string[]): Record<keyof typeof SINONIMOS, number> | null {
  const normalizada = linha.map(normalizar);
  const usadas = new Set<number>();
  const achado = {} as Record<keyof typeof SINONIMOS, number>;
  for (const campo of ["preco", "descricao", "unidade", "codigo"] as const) {
    const indice = SINONIMOS[campo].map((nome) => normalizada.findIndex((celula, i) => celula === nome && !usadas.has(i))).find((i) => i >= 0);
    if (indice === undefined) return null;
    achado[campo] = indice;
    usadas.add(indice);
  }
  return achado;
}

/** CSV exportado de planilha: separador `;` (padrão brasileiro) ou `,`, com aspas. */
function linhasDoCsv(texto: string): string[][] {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const separador = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = []; let celula = ""; let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { celula += '"'; i += 1; }
      else if (c === '"') aspas = false;
      else celula += c;
    } else if (c === '"') aspas = true;
    else if (c === separador) { linha.push(celula); celula = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i += 1;
      linha.push(celula); linhas.push(linha); linha = []; celula = "";
    } else celula += c;
  }
  if (celula || linha.length) { linha.push(celula); linhas.push(linha); }
  return linhas;
}

function interpretarLinhas(aba: string, linhas: string[][]): InterpretacaoGoinfra | null {
  // O cabeçalho vem depois do título, do órgão e da referência; trinta linhas cobrem isso.
  const linhaDoCabecalho = linhas.slice(0, 30).findIndex((linha) => acharColunas(linha) !== null);
  if (linhaDoCabecalho < 0) return null;
  const colunas = acharColunas(linhas[linhaDoCabecalho])!;
  const itens: ItemGoinfra[] = [];
  const vistos = new Set<string>();
  let ignoradas = 0;
  for (const linha of linhas.slice(linhaDoCabecalho + 1)) {
    const codigo = (linha[colunas.codigo] ?? "").trim();
    const descricao = (linha[colunas.descricao] ?? "").replace(/\s+/g, " ").trim();
    const unidade = (linha[colunas.unidade] ?? "").trim();
    const custo = paraCentavos(linha[colunas.preco] ?? "");
    // Sem código, descrição, unidade ou preço legível é título de grupo, subtotal ou
    // rodapé. A contagem entra no registro da importação.
    if (!codigo || !descricao || !unidade || custo === null) { if (linha.some((c) => c.trim())) ignoradas += 1; continue; }
    if (vistos.has(codigo)) { ignoradas += 1; continue; }
    vistos.add(codigo);
    itens.push({ codigo: codigo.slice(0, 40), descricao: descricao.slice(0, 600), unidade: unidade.slice(0, 16), custoUnitarioCentavos: custo });
  }
  return { itens, aba, linhaDoCabecalho, ignoradas };
}

export function interpretarGoinfra(dados: Buffer, nomeDoArquivo: string): InterpretacaoGoinfra {
  const ehZip = dados.length > 4 && dados[0] === 0x50 && dados[1] === 0x4b;
  if (ehZip) {
    const planilha = abrirPlanilha(dados);
    for (const aba of planilha.abas) {
      const resultado = interpretarLinhas(aba, planilha.linhas(aba));
      if (resultado && resultado.itens.length) return resultado;
    }
    throw new Error(`nenhuma aba tem cabeçalho com código, descrição, unidade e preço; abas: ${planilha.abas.map((a) => `"${a}"`).join(", ")}.`);
  }
  if (!/\.csv$/i.test(nomeDoArquivo)) throw new Error("envie a planilha em XLSX ou CSV. XLS antigo e PDF não são lidos: abra no Excel e salve como XLSX.");
  const texto = new TextDecoder("utf-8").decode(dados).replace(/^﻿/, "");
  const resultado = interpretarLinhas(nomeDoArquivo, linhasDoCsv(texto));
  if (!resultado || !resultado.itens.length) throw new Error("o CSV não tem cabeçalho com código, descrição, unidade e preço.");
  return resultado;
}
