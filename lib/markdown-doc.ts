// Markdown do criador de documentos, lido em blocos.
//
// O mesmo resultado alimenta a prévia na tela e o PDF gerado: o que a pessoa vê é o que
// sai no arquivo. Cobre o que um memorial, uma ata ou um escopo usam — títulos, parágrafos,
// listas, citações, código, tabelas simples e linha divisória — e nada de HTML: texto que
// parece tag continua sendo texto.

/** Trecho com texto "\n" é quebra de linha dentro do parágrafo. */
export type Trecho = { texto: string; negrito?: boolean; italico?: boolean; codigo?: boolean };

export type Bloco =
  | { tipo: "titulo"; nivel: 1 | 2 | 3; trechos: Trecho[] }
  | { tipo: "paragrafo"; trechos: Trecho[] }
  | { tipo: "lista"; ordenada: boolean; inicio: number; itens: Trecho[][] }
  | { tipo: "citacao"; trechos: Trecho[] }
  | { tipo: "codigo"; linhas: string[] }
  | { tipo: "tabela"; cabecalho: Trecho[][]; linhas: Trecho[][][] }
  | { tipo: "divisoria" };

/** Negrito (**), itálico (* ou _), código (`) e link [texto](url), que vira "texto (url)". */
export function lerTrechos(linha: string): Trecho[] {
  const trechos: Trecho[] = [];
  const padrao = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let ultimo = 0;
  for (const achado of linha.matchAll(padrao)) {
    const inicio = achado.index ?? 0;
    if (inicio > ultimo) trechos.push({ texto: linha.slice(ultimo, inicio) });
    const [inteiro, codigo, negrito, italico, link] = achado;
    if (codigo) trechos.push({ texto: codigo.slice(1, -1), codigo: true });
    else if (negrito) trechos.push(...lerTrechos(negrito.slice(2, -2)).map((t) => ({ ...t, negrito: true })));
    else if (italico) trechos.push(...lerTrechos(italico.slice(1, -1)).map((t) => ({ ...t, italico: true })));
    else if (link) {
      const [, texto, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(link)!;
      trechos.push(...lerTrechos(texto), { texto: ` (${url})` });
    }
    ultimo = inicio + inteiro.length;
  }
  if (ultimo < linha.length) trechos.push({ texto: linha.slice(ultimo) });
  return trechos.filter((t) => t.texto.length);
}

const celulas = (linha: string) => linha.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => lerTrechos(c.trim()));
const ehSeparadorTabela = (linha: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(linha);

export function lerMarkdown(fonte: string): Bloco[] {
  const linhas = fonte.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocos: Bloco[] = [];
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    if (!linha.trim()) { i += 1; continue; }
    if (/^\s*```/.test(linha)) {
      const codigo: string[] = [];
      i += 1;
      while (i < linhas.length && !/^\s*```/.test(linhas[i])) { codigo.push(linhas[i]); i += 1; }
      blocos.push({ tipo: "codigo", linhas: codigo });
      i += 1;
      continue;
    }
    const titulo = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(linha);
    if (titulo) {
      blocos.push({ tipo: "titulo", nivel: Math.min(3, titulo[1].length) as 1 | 2 | 3, trechos: lerTrechos(titulo[2]) });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(linha)) { blocos.push({ tipo: "divisoria" }); i += 1; continue; }
    if (linha.includes("|") && i + 1 < linhas.length && ehSeparadorTabela(linhas[i + 1])) {
      const cabecalho = celulas(linha);
      const corpo: Trecho[][][] = [];
      i += 2;
      while (i < linhas.length && linhas[i].includes("|") && linhas[i].trim()) { corpo.push(celulas(linhas[i])); i += 1; }
      blocos.push({ tipo: "tabela", cabecalho, linhas: corpo });
      continue;
    }
    if (/^\s*>/.test(linha)) {
      const partes: string[] = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) { partes.push(linhas[i].replace(/^\s*>\s?/, "")); i += 1; }
      blocos.push({ tipo: "citacao", trechos: lerTrechos(partes.join(" ").trim()) });
      continue;
    }
    const item = /^\s*([-*+]|(\d{1,4})[.)])\s+(.*)$/.exec(linha);
    if (item) {
      const ordenada = Boolean(item[2]);
      const inicio = ordenada ? Number(item[2]) : 1;
      const itens: string[] = [];
      while (i < linhas.length) {
        const atual = /^\s*([-*+]|(\d{1,4})[.)])\s+(.*)$/.exec(linhas[i]);
        if (atual && Boolean(atual[2]) === ordenada) { itens.push(atual[3]); i += 1; continue; }
        // Linha recuada logo depois de um item continua o mesmo item.
        if (itens.length && linhas[i].trim() && /^\s{2,}/.test(linhas[i])) { itens[itens.length - 1] += ` ${linhas[i].trim()}`; i += 1; continue; }
        break;
      }
      blocos.push({ tipo: "lista", ordenada, inicio, itens: itens.map(lerTrechos) });
      continue;
    }
    const paragrafo: string[] = [];
    while (i < linhas.length && linhas[i].trim() && !/^\s*(```|#{1,6}\s|>|([-*+]|\d{1,4}[.)])\s)/.test(linhas[i])) {
      paragrafo.push(linhas[i].trim());
      i += 1;
    }
    // Linha que nenhuma regra consumiu ainda vira texto: nunca se para no mesmo lugar.
    if (!paragrafo.length) { paragrafo.push(linha.trim()); i += 1; }
    // Cada linha escrita continua sendo uma linha: "Cliente:" e "Endereço:" não se fundem.
    blocos.push({ tipo: "paragrafo", trechos: paragrafo.flatMap((texto, n) => n ? [{ texto: "\n" }, ...lerTrechos(texto)] : lerTrechos(texto)) });
  }
  return blocos;
}

/** Primeiro título do documento, para nomear o arquivo e o metadado do PDF. */
export function tituloDoMarkdown(fonte: string) {
  const bloco = lerMarkdown(fonte).find((b) => b.tipo === "titulo");
  return bloco && bloco.tipo === "titulo" ? bloco.trechos.map((t) => t.texto).join("").trim() : "";
}

export type ItemTexto = { texto: string; x: number; y: number; altura: number };

/**
 * Texto extraído de um PDF de volta em Markdown. As linhas são reagrupadas pela altura
 * na página; letra bem maior que a mediana vira título. É uma aproximação declarada:
 * PDF guarda posição de letras, não estrutura de documento.
 */
export function paginasParaMarkdown(paginas: ItemTexto[][]) {
  // Mediana ponderada pelo número de letras: o corpo do texto tem mais letras que os títulos,
  // mesmo quando a página tem poucas linhas.
  const alturas = paginas.flat().filter((item) => item.texto.trim()).map((item) => ({ altura: item.altura, peso: item.texto.trim().length })).sort((a, b) => a.altura - b.altura);
  const metade = alturas.reduce((soma, item) => soma + item.peso, 0) / 2;
  let acumulado = 0;
  const mediana = alturas.find((item) => (acumulado += item.peso) >= metade)?.altura ?? 10;
  const saida: string[] = [];
  for (const itens of paginas) {
    const linhas: { y: number; altura: number; itens: ItemTexto[] }[] = [];
    for (const item of [...itens].filter((i) => i.texto.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const linha = linhas.find((l) => Math.abs(l.y - item.y) <= Math.max(2, l.altura * 0.4));
      if (linha) { linha.itens.push(item); linha.altura = Math.max(linha.altura, item.altura); }
      else linhas.push({ y: item.y, altura: item.altura, itens: [item] });
    }
    linhas.sort((a, b) => b.y - a.y);
    let anterior: { y: number; altura: number } | null = null;
    for (const linha of linhas) {
      const texto = linha.itens.sort((a, b) => a.x - b.x).map((i) => i.texto).join(" ").replace(/\s+/g, " ").trim();
      if (anterior && anterior.y - linha.y > Math.max(anterior.altura, linha.altura) * 1.8) saida.push("");
      if (linha.altura >= mediana * 1.6) { if (saida.length && saida.at(-1) !== "") saida.push(""); saida.push(`# ${texto}`, ""); }
      else if (linha.altura >= mediana * 1.25) { if (saida.length && saida.at(-1) !== "") saida.push(""); saida.push(`## ${texto}`, ""); }
      else saida.push(texto);
      anterior = linha;
    }
    if (saida.length) saida.push("", "---", "");
  }
  while (saida.length && ["", "---"].includes(saida.at(-1)!)) saida.pop();
  return saida.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
