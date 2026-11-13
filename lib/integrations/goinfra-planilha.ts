import { z } from "zod";

import { abrirPlanilha, type Planilha } from "./planilha-xlsx";
import { abrirPlanilhaXls, ehXls } from "./planilha-xls";
import { paraCentavos } from "./sinapi-planilha";

// Interpretação da tabela de preços da GOINFRA (Agência Goiana de Infraestrutura e
// Transportes).
//
// A agência publica as tabelas em goias.gov.br/goinfra, em XLS (Excel 97), por data-base
// bimestral e com versões com e sem desoneração: custo referencial de materiais, de mão de
// obra e o relatório sintético de serviços de obras civis. Não há API: a plataforma lê a
// página de cada tabela e baixa o arquivo (lib/server/goinfra-fonte.ts), ou o
// superadministrador envia o arquivo oficial. Pela mesma razão da SINAPI, as colunas são achadas pelo NOME no
// cabeçalho, nunca pela posição — uma coluna lida no lugar errado vira preço errado em
// silêncio, e isso é pior do que recusar o arquivo.

export const TABELAS_GOINFRA = ["materiais", "obras-civis", "mao-de-obra", "rodoviaria"] as const;
export type TabelaGoinfra = typeof TABELAS_GOINFRA[number];
export const rotuloTabelaGoinfra: Record<TabelaGoinfra, string> = {
  materiais: "Materiais (insumos)", "obras-civis": "Serviços de obras civis", "mao-de-obra": "Mão de obra (insumos)", rodoviaria: "Rodoviária",
};
export const REGIMES_GOINFRA = ["Desonerado", "NaoDesonerado"] as const;
export const rotuloRegimeGoinfra: Record<typeof REGIMES_GOINFRA[number], string> = { Desonerado: "Desonerada", NaoDesonerado: "Não desonerada" };

// Referência e regime são opcionais: a planilha oficial traz os dois no cabeçalho. Quando
// informados, precisam bater com ela.
export const envioGoinfraSchema = z.object({
  referencia: z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a referência no formato AAAA-MM.")]).transform((v) => v || undefined),
  tabela: z.enum(TABELAS_GOINFRA),
  regime: z.union([z.literal(""), z.null(), z.enum(REGIMES_GOINFRA)]).transform((v) => v || undefined),
});

export type ItemGoinfra = { codigo: string; descricao: string; unidade: string; custoUnitarioCentavos: number };
/** O que a própria planilha diz sobre si: data-base, regime e número da tabela. */
export type CabecalhoGoinfra = { dataBase: string | null; regime: "Desonerado" | "NaoDesonerado" | null; numero: string | null; titulo: string };
export type InterpretacaoGoinfra = { itens: ItemGoinfra[]; aba: string; linhaDoCabecalho: number; ignoradas: number; cabecalho: CabecalhoGoinfra };

const SINONIMOS: Record<"codigo" | "descricao" | "unidade" | "preco", string[]> = {
  codigo: ["codigo", "codigo auxiliar", "cod", "item", "codigo goinfra", "codigo do servico", "codigo do insumo"],
  descricao: ["descricao", "descricao do material", "descricao da mao de obra", "descricao do servico", "descricao do insumo", "descricao do produto", "discriminacao", "servico", "especificacao", "produto", "material", "nome do produto"],
  unidade: ["unidade", "und", "un", "unid"],
  preco: ["preco unitario", "custo unitario", "valor com encargos", "valor unitario", "preco a vista", "preco de venda", "preco total", "custo total", "preco", "custo", "valor", "total"],
};

// Acento, caixa, pontuação e espaço repetido não podem decidir se a coluna é achada:
// "UNID." e "Preço Unitário (R$)" precisam casar com "unid" e "preco unitario".
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(r\$\)|r\$/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function acharColunas(linha: string[], codigoObrigatorio: boolean): Record<keyof typeof SINONIMOS, number> | null {
  const normalizada = linha.map(normalizar);
  const usadas = new Set<number>();
  const achado = {} as Record<keyof typeof SINONIMOS, number>;
  for (const campo of ["preco", "descricao", "unidade", "codigo"] as const) {
    const indice = SINONIMOS[campo].map((nome) => normalizada.findIndex((celula, i) => celula === nome && !usadas.has(i))).find((i) => i >= 0);
    if (indice === undefined) {
      // Lista de loja nem sempre traz código; a da GOINFRA sempre traz.
      if (campo === "codigo" && !codigoObrigatorio) { achado.codigo = -1; continue; }
      return null;
    }
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

function interpretarLinhas(aba: string, linhas: string[][], codigoObrigatorio: boolean): InterpretacaoGoinfra | null {
  // O cabeçalho vem depois do título, do órgão e da referência; trinta linhas cobrem isso.
  const linhaDoCabecalho = linhas.slice(0, 30).findIndex((linha) => acharColunas(linha, codigoObrigatorio) !== null);
  if (linhaDoCabecalho < 0) return null;
  const colunas = acharColunas(linhas[linhaDoCabecalho], codigoObrigatorio)!;
  const itens: ItemGoinfra[] = [];
  const vistos = new Set<string>();
  let ignoradas = 0;
  for (const linha of linhas.slice(linhaDoCabecalho + 1)) {
    const codigo = colunas.codigo < 0 ? "" : (linha[colunas.codigo] ?? "").trim();
    const descricao = (linha[colunas.descricao] ?? "").replace(/\s+/g, " ").trim();
    const unidade = (linha[colunas.unidade] ?? "").trim();
    const custo = paraCentavos(linha[colunas.preco] ?? "");
    // Sem código, descrição, unidade ou preço legível é título de grupo, subtotal ou
    // rodapé. A contagem entra no registro da importação.
    // "S/U" (sem unidade) é a linha de título de grupo da GOINFRA, com custo zero.
    if ((codigoObrigatorio && !codigo) || !descricao || !unidade || /^s\/u$/i.test(unidade) || custo === null) { if (linha.some((c) => c.trim())) ignoradas += 1; continue; }
    // Sem código, o item é identificado pela descrição e unidade.
    const chave = codigo || `${descricao.toLowerCase()}|${unidade.toLowerCase()}`;
    if (vistos.has(chave)) { ignoradas += 1; continue; }
    vistos.add(chave);
    itens.push({ codigo: codigo.slice(0, 40), descricao: descricao.slice(0, 600), unidade: unidade.slice(0, 16), custoUnitarioCentavos: custo });
  }
  return { itens, aba, linhaDoCabecalho, ignoradas, cabecalho: lerCabecalho(linhas.slice(0, linhaDoCabecalho)) };
}

function lerCabecalho(linhas: string[][]): CabecalhoGoinfra {
  const texto = linhas.map((l) => l.filter((c) => c.trim()).join(" ")).join(" | ").replace(/\s+/g, " ");
  const data = /data\s*base:?\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(texto);
  const semAcento = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const tabela = linhas.flat().find((c) => /TABELA DE CUSTOS/i.test(c)) ?? "";
  return {
    dataBase: data ? `${data[3]}-${data[2]}` : null,
    regime: /SEM DESONERA/.test(semAcento) ? "NaoDesonerado" : /COM DESONERA/.test(semAcento) ? "Desonerado" : null,
    numero: /\bT(\d{3})\b/.exec(tabela)?.[1] ?? null,
    titulo: tabela.trim().slice(0, 200),
  };
}

export function interpretarGoinfra(dados: Buffer, nomeDoArquivo: string): InterpretacaoGoinfra {
  return lerTabelaDePrecos(dados, nomeDoArquivo, true);
}

/**
 * Lê qualquer tabela de preços com cabeçalho de descrição, unidade e preço (e código,
 * quando `codigoObrigatorio`). Serve à GOINFRA e à lista de preços que uma loja envia.
 */
export function lerTabelaDePrecos(dados: Buffer, nomeDoArquivo: string, codigoObrigatorio: boolean): InterpretacaoGoinfra {
  const ehZip = dados.length > 4 && dados[0] === 0x50 && dados[1] === 0x4b;
  if (ehZip || ehXls(dados)) {
    const planilha: Planilha = ehZip ? abrirPlanilha(dados) : abrirPlanilhaXls(dados);
    for (const aba of planilha.abas) {
      const resultado = interpretarLinhas(aba, planilha.linhas(aba), codigoObrigatorio);
      if (resultado && resultado.itens.length) return resultado;
    }
    throw new Error(`nenhuma aba tem cabeçalho com ${codigoObrigatorio ? "código, " : ""}descrição, unidade e preço; abas: ${planilha.abas.map((a) => `"${a}"`).join(", ")}.`);
  }
  if (!/\.csv$/i.test(nomeDoArquivo)) throw new Error("envie a planilha em XLS, XLSX ou CSV. PDF não é lido.");
  const texto = new TextDecoder("utf-8").decode(dados).replace(/^﻿/, "");
  const resultado = interpretarLinhas(nomeDoArquivo, linhasDoCsv(texto), codigoObrigatorio);
  if (!resultado || !resultado.itens.length) throw new Error(`o CSV não tem cabeçalho com ${codigoObrigatorio ? "código, " : ""}descrição, unidade e preço.`);
  return resultado;
}
