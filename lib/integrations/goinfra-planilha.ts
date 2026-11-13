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

export const TABELAS_GOINFRA = ["obras-civis", "rodoviaria", "insumos-materiais", "insumos-mao-de-obra", "insumos-equipamentos"] as const;
export type TabelaGoinfra = typeof TABELAS_GOINFRA[number];
export const rotuloTabelaGoinfra: Record<TabelaGoinfra, string> = {
  "obras-civis": "Obras civis", rodoviaria: "Rodoviária", "insumos-materiais": "Insumos · materiais",
  "insumos-mao-de-obra": "Insumos · mão de obra", "insumos-equipamentos": "Insumos · equipamentos",
};
export const REGIMES_GOINFRA = ["Desonerado", "NaoDesonerado"] as const;
export const rotuloRegimeGoinfra: Record<typeof REGIMES_GOINFRA[number], string> = { Desonerado: "Desonerada", NaoDesonerado: "Não desonerada" };

export const envioGoinfraSchema = z.object({
  referencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a referência no formato AAAA-MM."),
  tabela: z.enum(TABELAS_GOINFRA),
  regime: z.enum(REGIMES_GOINFRA),
});

export type ItemGoinfra = { codigo: string; descricao: string; unidade: string; custoUnitarioCentavos: number };
export type AbaLida = { aba: string; linhaDoCabecalho: number; itens: number; ignoradas: number };
// `aba` junta o nome de todas as abas lidas; `abas` traz a contagem de cada uma, inclusive
// as que não têm cabeçalho reconhecido (itens 0, linhaDoCabecalho -1), para que nenhuma
// fique de fora sem aviso.
export type InterpretacaoGoinfra = { itens: ItemGoinfra[]; aba: string; linhaDoCabecalho: number; ignoradas: number; abas: AbaLida[] };

const SINONIMOS: Record<"codigo" | "descricao" | "unidade" | "preco", string[]> = {
  codigo: ["codigo", "cod", "item", "codigo goinfra", "codigo do servico", "codigo do insumo"],
  descricao: ["descricao", "descricao do servico", "descricao do insumo", "descricao do produto", "discriminacao", "servico", "especificacao", "produto", "material", "nome do produto"],
  unidade: ["unidade", "und", "un", "unid"],
  preco: ["preco unitario", "custo unitario", "valor unitario", "preco a vista", "preco de venda", "preco total", "custo total", "preco", "custo", "valor"],
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

type Parcial = { itens: ItemGoinfra[]; aba: string; linhaDoCabecalho: number; ignoradas: number };
function interpretarLinhas(aba: string, linhas: string[][], codigoObrigatorio: boolean, vistos = new Set<string>()): Parcial | null {
  // O cabeçalho vem depois do título, do órgão e da referência; trinta linhas cobrem isso.
  const linhaDoCabecalho = linhas.slice(0, 30).findIndex((linha) => acharColunas(linha, codigoObrigatorio) !== null);
  if (linhaDoCabecalho < 0) return null;
  const colunas = acharColunas(linhas[linhaDoCabecalho], codigoObrigatorio)!;
  const itens: ItemGoinfra[] = [];
  let ignoradas = 0;
  for (const linha of linhas.slice(linhaDoCabecalho + 1)) {
    const codigo = colunas.codigo < 0 ? "" : (linha[colunas.codigo] ?? "").trim();
    const descricao = (linha[colunas.descricao] ?? "").replace(/\s+/g, " ").trim();
    const unidade = (linha[colunas.unidade] ?? "").trim();
    const custo = paraCentavos(linha[colunas.preco] ?? "");
    // Sem código, descrição, unidade ou preço legível é título de grupo, subtotal ou
    // rodapé. A contagem entra no registro da importação.
    if ((codigoObrigatorio && !codigo) || !descricao || !unidade || custo === null) { if (linha.some((c) => c.trim())) ignoradas += 1; continue; }
    // Sem código, o item é identificado pela descrição e unidade.
    const chave = codigo || `${descricao.toLowerCase()}|${unidade.toLowerCase()}`;
    if (vistos.has(chave)) { ignoradas += 1; continue; }
    vistos.add(chave);
    itens.push({ codigo: codigo.slice(0, 40), descricao: descricao.slice(0, 600), unidade: unidade.slice(0, 16), custoUnitarioCentavos: custo });
  }
  return { itens, aba, linhaDoCabecalho, ignoradas };
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
  if (dados.length > 4 && dados[0] === 0xd0 && dados[1] === 0xcf && dados[2] === 0x11 && dados[3] === 0xe0) {
    throw new Error("o arquivo é XLS antigo (Excel 97-2003), que não é lido: abra no Excel e salve como XLSX.");
  }
  if (ehZip) {
    // Todas as abas entram: a tabela oficial costuma separar serviços por grupo (ou
    // insumos por tipo) em abas diferentes, e parar na primeira deixaria itens de fora.
    // O mesmo código em duas abas fica com a primeira ocorrência e conta como ignorado.
    const planilha = abrirPlanilha(dados);
    const vistos = new Set<string>();
    const itens: ItemGoinfra[] = [];
    const abas: AbaLida[] = [];
    for (const aba of planilha.abas) {
      const resultado = interpretarLinhas(aba, planilha.linhas(aba), codigoObrigatorio, vistos);
      abas.push({ aba, linhaDoCabecalho: resultado?.linhaDoCabecalho ?? -1, itens: resultado?.itens.length ?? 0, ignoradas: resultado?.ignoradas ?? 0 });
      if (resultado) itens.push(...resultado.itens);
    }
    const lidas = abas.filter((a) => a.itens > 0);
    if (!lidas.length) throw new Error(`nenhuma aba tem cabeçalho com ${codigoObrigatorio ? "código, " : ""}descrição, unidade e preço; abas: ${planilha.abas.map((a) => `"${a}"`).join(", ")}.`);
    return { itens, aba: lidas.map((a) => a.aba).join(", "), linhaDoCabecalho: lidas[0].linhaDoCabecalho, ignoradas: abas.reduce((t, a) => t + a.ignoradas, 0), abas };
  }
  if (!/\.csv$/i.test(nomeDoArquivo)) throw new Error("envie a planilha em XLSX ou CSV. XLS antigo e PDF não são lidos: abra no Excel e salve como XLSX.");
  const texto = new TextDecoder("utf-8").decode(dados).replace(/^﻿/, "");
  const resultado = interpretarLinhas(nomeDoArquivo, linhasDoCsv(texto), codigoObrigatorio);
  if (!resultado || !resultado.itens.length) throw new Error(`o CSV não tem cabeçalho com ${codigoObrigatorio ? "código, " : ""}descrição, unidade e preço.`);
  return { ...resultado, abas: [{ aba: resultado.aba, linhaDoCabecalho: resultado.linhaDoCabecalho, itens: resultado.itens.length, ignoradas: resultado.ignoradas }] };
}

// ## Busca automática
//
// A GOINFRA publica cada tabela como arquivo no portal do Governo de Goiás, com o nome que
// diz o que é: "OBRAS CIVIS - TABELA 291 - FEVEREIRO-2025 - COM DESONERAÇÃO - Publicada em
// 05-05-2025...". Sem API, a busca lê a página de tabelas, acha os links de planilha e
// classifica cada um pelo nome. Nome que não diz tabela, mês e regime é descartado — nunca
// adivinhado.

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export type ArquivoGoinfra = { url: string; nome: string; tabela: TabelaGoinfra; regime: typeof REGIMES_GOINFRA[number]; referencia: string };

export function classificarArquivoGoinfra(nome: string): Omit<ArquivoGoinfra, "url" | "nome"> | null {
  const texto = normalizar(decodeURIComponent(nome.replace(/\+/g, " ")));
  let tabela: TabelaGoinfra | null = null;
  if (/\bobras? civis\b/.test(texto)) tabela = "obras-civis";
  else if (/\brodoviari/.test(texto)) tabela = "rodoviaria";
  else if (/\binsumos?\b.*\bmateria/.test(texto)) tabela = "insumos-materiais";
  else if (/\binsumos?\b.*\bmao de obra\b/.test(texto)) tabela = "insumos-mao-de-obra";
  else if (/\binsumos?\b.*\bequipamento/.test(texto)) tabela = "insumos-equipamentos";
  if (!tabela) return null;
  // "sem desoneração" precisa ser testado antes: "com desoneração" não casa com ele, mas
  // "desonera" sozinho casaria com os dois.
  const regime = /\b(sem|nao) desonera/.test(texto) ? "NaoDesonerado" : /\b(com )?desonerad|\bcom desonera/.test(texto) ? "Desonerado" : null;
  if (!regime) return null;
  const mes = new RegExp(`\\b(${MESES.join("|")}) (\\d{4})\\b`).exec(texto);
  if (!mes) return null;
  return { tabela, regime, referencia: `${mes[2]}-${String(MESES.indexOf(mes[1]) + 1).padStart(2, "0")}` };
}

/** Links de uma página HTML, resolvidos contra a URL da página. */
export function linksDaPagina(html: string, base: string): { url: string; texto: string }[] {
  const links: { url: string; texto: string }[] = [];
  for (const [, href, corpo] of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), base);
      if (url.protocol === "https:") links.push({ url: url.toString(), texto: corpo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    } catch { /* href inválido */ }
  }
  return links;
}

/** Arquivos de planilha da página, classificados; o que não se classifica fica de fora. */
export function arquivosGoinfra(links: { url: string; texto: string }[]): ArquivoGoinfra[] {
  const arquivos = new Map<string, ArquivoGoinfra>();
  for (const { url, texto } of links) {
    const caminho = new URL(url).pathname;
    if (!/\.(xlsx|csv)$/i.test(caminho)) continue;
    const nome = decodeURIComponent(caminho.split("/").pop() ?? "");
    const tipo = classificarArquivoGoinfra(nome) ?? classificarArquivoGoinfra(texto);
    if (tipo && !arquivos.has(url)) arquivos.set(url, { url, nome, ...tipo });
  }
  return [...arquivos.values()];
}

/** A referência mais nova de cada tabela e regime. */
export function maisRecentes(arquivos: ArquivoGoinfra[]): ArquivoGoinfra[] {
  const melhor = new Map<string, ArquivoGoinfra>();
  for (const a of arquivos) {
    const chave = `${a.tabela}|${a.regime}`;
    const atual = melhor.get(chave);
    if (!atual || a.referencia > atual.referencia) melhor.set(chave, a);
  }
  return [...melhor.values()].sort((x, y) => `${x.tabela}${x.regime}`.localeCompare(`${y.tabela}${y.regime}`));
}
