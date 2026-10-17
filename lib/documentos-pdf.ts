import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import { lerMarkdown, type Trecho } from "@/lib/markdown-doc";

// Operações da aba Documentos e PDF: juntar, organizar, dividir, carimbar, montar PDF de
// imagens e gerar PDF de um documento em Markdown.
//
// Tudo roda no navegador da pessoa: o arquivo só sai do computador se ela pedir para
// guardar na biblioteca. O código não toca DOM nem rede, por isso os testes rodam no Node.
//
// O `lib/pdf-writer.ts` escreve PDF novo, mas não lê PDF existente; juntar e reorganizar
// páginas exige ler a estrutura do arquivo, e é para isso que entra o pdf-lib.

export class PdfInvalido extends Error {}

export async function abrirPdf(bytes: Uint8Array, nome = "arquivo") {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : "";
    if (/encrypt/i.test(texto)) throw new PdfInvalido(`“${nome}” está protegido por senha. Remova a senha no programa de origem e envie de novo.`);
    throw new PdfInvalido(`“${nome}” não é um PDF válido ou está corrompido.`);
  }
}

function produtor(documento: PDFDocument, titulo?: string) {
  documento.setProducer("DRAP Backoffice");
  documento.setCreator("DRAP Backoffice · Documentos e PDF");
  if (titulo) documento.setTitle(titulo);
}

export async function contarPaginas(bytes: Uint8Array, nome?: string) {
  return (await abrirPdf(bytes, nome)).getPageCount();
}

/** Junta os PDFs na ordem recebida, com todas as páginas de cada um. */
export async function juntarPdfs(arquivos: { nome: string; bytes: Uint8Array }[]) {
  if (arquivos.length < 2) throw new PdfInvalido("Escolha pelo menos dois PDFs para juntar.");
  const destino = await PDFDocument.create();
  for (const arquivo of arquivos) {
    const origem = await abrirPdf(arquivo.bytes, arquivo.nome);
    const paginas = await destino.copyPages(origem, origem.getPageIndices());
    for (const pagina of paginas) destino.addPage(pagina);
  }
  produtor(destino);
  return destino.save();
}

export type PaginaOrganizada = { indice: number; giro: 0 | 90 | 180 | 270 };

/** Novo PDF com as páginas na ordem pedida, cada uma com o giro somado ao que já tinha. Página fora da lista sai. */
export async function organizarPdf(bytes: Uint8Array, paginas: PaginaOrganizada[], nome?: string) {
  if (!paginas.length) throw new PdfInvalido("O PDF precisa manter pelo menos uma página.");
  const origem = await abrirPdf(bytes, nome);
  const total = origem.getPageCount();
  if (paginas.some((p) => !Number.isInteger(p.indice) || p.indice < 0 || p.indice >= total)) throw new PdfInvalido("Página fora do arquivo.");
  const destino = await PDFDocument.create();
  const copias = await destino.copyPages(origem, paginas.map((p) => p.indice));
  copias.forEach((pagina, posicao) => {
    const atual = pagina.getRotation().angle;
    pagina.setRotation(degrees((((atual + paginas[posicao].giro) % 360) + 360) % 360));
    destino.addPage(pagina);
  });
  produtor(destino, origem.getTitle());
  return destino.save();
}

/**
 * "1-3, 5, 8-" em grupos de páginas (base zero). Cada trecho separado por vírgula vira um
 * arquivo. Erro descreve o trecho que não fecha, em vez de devolver algo diferente do pedido.
 */
export function lerIntervalos(texto: string, total: number): number[][] {
  const trechos = texto.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  if (!trechos.length) throw new PdfInvalido("Informe as páginas, por exemplo: 1-3, 5, 8-.");
  return trechos.map((trecho) => {
    const achado = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(trecho);
    if (!achado || (!achado[1] && !achado[3])) throw new PdfInvalido(`Não entendi “${trecho}”. Use números e hífen, como 2-4.`);
    const inicio = achado[1] ? Number(achado[1]) : 1;
    const fim = achado[2] ? (achado[3] ? Number(achado[3]) : total) : inicio;
    if (inicio < 1 || fim > total || inicio > fim) throw new PdfInvalido(`O trecho “${trecho}” não existe: o arquivo tem ${total} página(s).`);
    return Array.from({ length: fim - inicio + 1 }, (_, i) => inicio - 1 + i);
  });
}

/** Um PDF para cada grupo de páginas. */
export async function dividirPdf(bytes: Uint8Array, grupos: number[][], nome?: string) {
  const origem = await abrirPdf(bytes, nome);
  const saidas: Uint8Array[] = [];
  for (const grupo of grupos) {
    const destino = await PDFDocument.create();
    for (const pagina of await destino.copyPages(origem, grupo)) destino.addPage(pagina);
    produtor(destino, origem.getTitle());
    saidas.push(await destino.save());
  }
  return saidas;
}

// --- texto nas fontes padrão -------------------------------------------------------------

// Fora do Latin-1, a codificação WinAnsi das fontes padrão só tem estes caracteres.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const TROCAS: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "✓": "v", "✔": "v", "−": "-", " ": " " };

/** Texto que as fontes padrão do PDF conseguem escrever; caractere sem equivalente vira "?". */
export function textoSeguro(texto: string) {
  let saida = "";
  for (const c of texto.normalize("NFC")) {
    if (TROCAS[c] !== undefined) { saida += TROCAS[c]; continue; }
    const codigo = c.codePointAt(0)!;
    if ((codigo >= 0x20 && codigo <= 0x7e) || (codigo >= 0xa0 && codigo <= 0xff) || WIN_ANSI_EXTRA.has(c)) saida += c;
    else if (codigo >= 0x20) saida += "?";
  }
  return saida;
}

// --- carimbo: números de página e marca d'água ------------------------------------------

/**
 * Converte um ponto da página como ela aparece na tela (origem embaixo à esquerda, já
 * girada) para o espaço do PDF. Sem isso, o número sai de lado na página girada.
 */
function pontoVisivel(pagina: PDFPage, vx: number, vy: number) {
  const caixa = pagina.getCropBox();
  const giro = ((pagina.getRotation().angle % 360) + 360) % 360;
  const { width: w, height: h } = caixa;
  const [x, y] = giro === 90 ? [w - vy, vx] : giro === 180 ? [w - vx, h - vy] : giro === 270 ? [vy, h - vx] : [vx, vy];
  return { x: x + caixa.x, y: y + caixa.y, giro };
}

function tamanhoVisivel(pagina: PDFPage) {
  const { width, height } = pagina.getCropBox();
  return pagina.getRotation().angle % 180 === 0 ? { largura: width, altura: height } : { largura: height, altura: width };
}

export type OpcoesCarimbo = {
  numeros?: { posicao: "rodape-centro" | "rodape-direita" | "topo-direita"; formato: "n" | "n-de-total"; primeiro: number; tamanho?: number };
  marca?: { texto: string; opacidade: number; tamanho: number };
};

export async function carimbarPdf(bytes: Uint8Array, opcoes: OpcoesCarimbo, nome?: string) {
  if (!opcoes.numeros && !opcoes.marca?.texto.trim()) throw new PdfInvalido("Escolha numerar as páginas, aplicar marca d'água ou os dois.");
  const documento = await abrirPdf(bytes, nome);
  const fonte = await documento.embedFont(StandardFonts.Helvetica);
  const negrito = await documento.embedFont(StandardFonts.HelveticaBold);
  const paginas = documento.getPages();
  paginas.forEach((pagina, indice) => {
    const { largura, altura } = tamanhoVisivel(pagina);
    if (opcoes.marca?.texto.trim()) {
      const texto = textoSeguro(opcoes.marca.texto.trim());
      const tamanho = Math.min(opcoes.marca.tamanho, (Math.hypot(largura, altura) * 0.8) / Math.max(1, negrito.widthOfTextAtSize(texto, 1)));
      const w = negrito.widthOfTextAtSize(texto, tamanho);
      const angulo = Math.atan2(altura, largura);
      // Centro da página, recuado meia largura e meia altura do texto ao longo da diagonal.
      const vx = largura / 2 - Math.cos(angulo) * w / 2 + Math.sin(angulo) * tamanho * 0.35;
      const vy = altura / 2 - Math.sin(angulo) * w / 2 - Math.cos(angulo) * tamanho * 0.35;
      const ponto = pontoVisivel(pagina, vx, vy);
      pagina.drawText(texto, { x: ponto.x, y: ponto.y, size: tamanho, font: negrito, color: rgb(0.45, 0.45, 0.45), opacity: Math.min(1, Math.max(0.05, opcoes.marca.opacidade)), rotate: degrees(angulo * 180 / Math.PI + ponto.giro) });
    }
    if (opcoes.numeros) {
      const n = opcoes.numeros.primeiro + indice;
      const texto = opcoes.numeros.formato === "n-de-total" ? `${n} de ${opcoes.numeros.primeiro + paginas.length - 1}` : String(n);
      const tamanho = opcoes.numeros.tamanho ?? 10;
      const w = fonte.widthOfTextAtSize(texto, tamanho);
      const margem = 28;
      const vx = opcoes.numeros.posicao === "rodape-centro" ? (largura - w) / 2 : largura - margem - w;
      const vy = opcoes.numeros.posicao === "topo-direita" ? altura - margem - tamanho : margem;
      const ponto = pontoVisivel(pagina, vx, vy);
      pagina.drawText(texto, { x: ponto.x, y: ponto.y, size: tamanho, font: fonte, color: rgb(0.2, 0.2, 0.2), rotate: degrees(ponto.giro) });
    }
  });
  return documento.save();
}

// --- imagens para PDF --------------------------------------------------------------------

export type ImagemParaPdf = { bytes: Uint8Array; tipo: "jpg" | "png" };
export type OpcoesImagens = { pagina: "a4" | "imagem"; orientacao: "auto" | "retrato" | "paisagem"; margem: number };

const A4 = { largura: 595.28, altura: 841.89 };

/** Uma imagem por página, sem recomprimir: JPEG e PNG entram com os bytes originais. */
export async function imagensParaPdf(imagens: ImagemParaPdf[], opcoes: OpcoesImagens, titulo?: string) {
  if (!imagens.length) throw new PdfInvalido("Escolha pelo menos uma imagem.");
  const documento = await PDFDocument.create();
  for (const imagem of imagens) {
    const embutida = imagem.tipo === "jpg" ? await documento.embedJpg(imagem.bytes) : await documento.embedPng(imagem.bytes);
    // A 150 dpi a foto mantém o tamanho físico razoável quando a página segue a imagem.
    const natural = { largura: embutida.width * 72 / 150, altura: embutida.height * 72 / 150 };
    if (opcoes.pagina === "imagem") {
      const margem = opcoes.margem;
      const pagina = documento.addPage([natural.largura + margem * 2, natural.altura + margem * 2]);
      pagina.drawImage(embutida, { x: margem, y: margem, width: natural.largura, height: natural.altura });
      continue;
    }
    const deitada = opcoes.orientacao === "paisagem" || (opcoes.orientacao === "auto" && embutida.width > embutida.height);
    const [largura, altura] = deitada ? [A4.altura, A4.largura] : [A4.largura, A4.altura];
    const pagina = documento.addPage([largura, altura]);
    const area = { largura: largura - opcoes.margem * 2, altura: altura - opcoes.margem * 2 };
    const escala = Math.min(area.largura / embutida.width, area.altura / embutida.height);
    const w = embutida.width * escala, h = embutida.height * escala;
    pagina.drawImage(embutida, { x: (largura - w) / 2, y: (altura - h) / 2, width: w, height: h });
  }
  produtor(documento, titulo);
  return documento.save();
}

/** Páginas já desenhadas como JPEG, cada uma no tamanho original em pontos. Base da redução de tamanho. */
export async function pdfDePaginasRenderizadas(paginas: { jpeg: Uint8Array; largura: number; altura: number }[], titulo?: string) {
  if (!paginas.length) throw new PdfInvalido("Nenhuma página para gravar.");
  const documento = await PDFDocument.create();
  for (const item of paginas) {
    const imagem = await documento.embedJpg(item.jpeg);
    documento.addPage([item.largura, item.altura]).drawImage(imagem, { x: 0, y: 0, width: item.largura, height: item.altura });
  }
  produtor(documento, titulo);
  return documento.save();
}

// --- documento em Markdown para PDF ------------------------------------------------------

type Fontes = { normal: PDFFont; negrito: PDFFont; italico: PDFFont; negritoItalico: PDFFont; mono: PDFFont };
type Palavra = { texto: string; fonte: PDFFont; largura: number; espaco: number };

const MARGEM = 56;
const CINZA = rgb(0.38, 0.38, 0.38);
const PRETO = rgb(0.1, 0.1, 0.1);

function fonteDo(trecho: Trecho, fontes: Fontes, base: "normal" | "negrito" = "normal") {
  if (trecho.codigo) return fontes.mono;
  const negrito = trecho.negrito || base === "negrito";
  if (negrito && trecho.italico) return fontes.negritoItalico;
  if (negrito) return fontes.negrito;
  if (trecho.italico) return fontes.italico;
  return fontes.normal;
}

const QUEBRA: Palavra = { texto: "", fonte: null as unknown as PDFFont, largura: 0, espaco: 0 };

/** Quebra os trechos em linhas que cabem na largura, preservando o estilo de cada palavra. */
function quebrarLinhas(trechos: Trecho[], fontes: Fontes, tamanho: number, largura: number, base: "normal" | "negrito" = "normal") {
  const palavras: Palavra[] = [];
  for (const trecho of trechos) {
    if (trecho.texto === "\n") { palavras.push(QUEBRA); continue; }
    const fonte = fonteDo(trecho, fontes, base);
    const partes = textoSeguro(trecho.texto).split(/(\s+)/);
    for (const parte of partes) {
      if (!parte) continue;
      if (/^\s+$/.test(parte)) { if (palavras.length) palavras[palavras.length - 1].espaco = fonte.widthOfTextAtSize(" ", tamanho); continue; }
      // Palavra maior que a linha inteira (um link longo) é cortada em pedaços que cabem.
      let resto = parte;
      while (fonte.widthOfTextAtSize(resto, tamanho) > largura && resto.length > 1) {
        let corte = resto.length - 1;
        while (corte > 1 && fonte.widthOfTextAtSize(resto.slice(0, corte), tamanho) > largura) corte -= 1;
        palavras.push({ texto: resto.slice(0, corte), fonte, largura: fonte.widthOfTextAtSize(resto.slice(0, corte), tamanho), espaco: 0 });
        resto = resto.slice(corte);
      }
      palavras.push({ texto: resto, fonte, largura: fonte.widthOfTextAtSize(resto, tamanho), espaco: 0 });
    }
  }
  const linhas: Palavra[][] = [];
  let atual: Palavra[] = [];
  let ocupado = 0;
  for (const palavra of palavras) {
    if (palavra === QUEBRA) { linhas.push(atual); atual = []; ocupado = 0; continue; }
    const antes = atual.length ? atual[atual.length - 1].espaco : 0;
    if (atual.length && ocupado + antes + palavra.largura > largura) { linhas.push(atual); atual = []; ocupado = 0; }
    ocupado += (atual.length ? atual[atual.length - 1].espaco : 0) + palavra.largura;
    atual.push(palavra);
  }
  if (atual.length) linhas.push(atual);
  return linhas;
}

export type OpcoesDocumento = { titulo?: string; numerarPaginas?: boolean };

export async function markdownParaPdf(fonte: string, opcoes: OpcoesDocumento = {}) {
  const blocos = lerMarkdown(fonte);
  if (!blocos.length) throw new PdfInvalido("Escreva o conteúdo do documento antes de gerar o PDF.");
  const documento = await PDFDocument.create();
  const fontes: Fontes = {
    normal: await documento.embedFont(StandardFonts.Helvetica),
    negrito: await documento.embedFont(StandardFonts.HelveticaBold),
    italico: await documento.embedFont(StandardFonts.HelveticaOblique),
    negritoItalico: await documento.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await documento.embedFont(StandardFonts.Courier),
  };
  const largura = A4.largura - MARGEM * 2;
  let pagina = documento.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM;
  const garantir = (altura: number) => {
    if (y - altura < MARGEM + (opcoes.numerarPaginas ? 18 : 0)) { pagina = documento.addPage([A4.largura, A4.altura]); y = A4.altura - MARGEM; }
  };
  const escreverLinhas = (linhas: Palavra[][], tamanho: number, x: number, cor = PRETO, entrelinha = 1.45) => {
    for (const linha of linhas) {
      garantir(tamanho * entrelinha);
      y -= tamanho * entrelinha;
      let cursor = x;
      for (const palavra of linha) {
        pagina.drawText(palavra.texto, { x: cursor, y: y + tamanho * 0.3, size: tamanho, font: palavra.fonte, color: cor });
        cursor += palavra.largura + palavra.espaco;
      }
    }
  };

  for (const bloco of blocos) {
    if (bloco.tipo === "titulo") {
      const tamanho = bloco.nivel === 1 ? 20 : bloco.nivel === 2 ? 15.5 : 13;
      const linhas = quebrarLinhas(bloco.trechos, fontes, tamanho, largura, "negrito");
      // Título não fica sozinho no pé da página: leva junto espaço para duas linhas de texto.
      garantir(tamanho * 1.3 * linhas.length + 40);
      y -= bloco.nivel === 1 ? 6 : 10;
      escreverLinhas(linhas, tamanho, MARGEM, PRETO, 1.3);
      y -= 6;
    } else if (bloco.tipo === "paragrafo") {
      escreverLinhas(quebrarLinhas(bloco.trechos, fontes, 11, largura), 11, MARGEM);
      y -= 7;
    } else if (bloco.tipo === "lista") {
      bloco.itens.forEach((item, posicao) => {
        const marcador = bloco.ordenada ? `${bloco.inicio + posicao}.` : "•";
        const linhas = quebrarLinhas(item, fontes, 11, largura - 18);
        garantir(11 * 1.45);
        pagina.drawText(marcador, { x: MARGEM + 2, y: y - 11 * 1.45 + 11 * 0.3, size: 11, font: fontes.normal, color: PRETO });
        escreverLinhas(linhas, 11, MARGEM + 18);
        y -= 2;
      });
      y -= 6;
    } else if (bloco.tipo === "citacao") {
      const linhas = quebrarLinhas(bloco.trechos.map((t) => ({ ...t, italico: true })), fontes, 11, largura - 16);
      const topo = y;
      const paginaInicial = pagina;
      escreverLinhas(linhas, 11, MARGEM + 14, CINZA);
      if (pagina === paginaInicial) pagina.drawRectangle({ x: MARGEM, y: y + 2, width: 2.5, height: topo - y - 2, color: rgb(0.75, 0.75, 0.75) });
      y -= 8;
    } else if (bloco.tipo === "codigo") {
      for (const original of bloco.linhas.length ? bloco.linhas : [""]) {
        const texto = textoSeguro(original);
        // Código não é reflowed: linha longa é cortada em pedaços, sem perder caractere.
        const porLinha = Math.max(1, Math.floor((largura - 12) / fontes.mono.widthOfTextAtSize("M", 9.5)));
        const pedacos = texto.length ? texto.match(new RegExp(`.{1,${porLinha}}`, "g"))! : [""];
        for (const pedaco of pedacos) {
          garantir(13);
          y -= 13;
          pagina.drawRectangle({ x: MARGEM, y: y - 1, width: largura, height: 13, color: rgb(0.95, 0.95, 0.95) });
          pagina.drawText(pedaco, { x: MARGEM + 6, y: y + 2.5, size: 9.5, font: fontes.mono, color: PRETO });
        }
      }
      y -= 10;
    } else if (bloco.tipo === "tabela") {
      const colunas = Math.max(bloco.cabecalho.length, ...bloco.linhas.map((l) => l.length));
      const larguraColuna = largura / colunas;
      const linhaDaTabela = (celulas: Trecho[][], cabecalho: boolean) => {
        const quebradas = Array.from({ length: colunas }, (_, c) => quebrarLinhas(celulas[c] ?? [], fontes, 9.5, larguraColuna - 10, cabecalho ? "negrito" : "normal"));
        const altura = Math.max(1, ...quebradas.map((l) => l.length)) * 9.5 * 1.35 + 8;
        garantir(altura);
        const topo = y;
        if (cabecalho) pagina.drawRectangle({ x: MARGEM, y: topo - altura, width: largura, height: altura, color: rgb(0.94, 0.94, 0.94) });
        quebradas.forEach((linhas, c) => {
          let linhaY = topo - 4;
          for (const linha of linhas) {
            linhaY -= 9.5 * 1.35;
            let cursor = MARGEM + c * larguraColuna + 5;
            for (const palavra of linha) {
              pagina.drawText(palavra.texto, { x: cursor, y: linhaY + 9.5 * 0.3, size: 9.5, font: palavra.fonte, color: PRETO });
              cursor += palavra.largura + palavra.espaco;
            }
          }
        });
        pagina.drawRectangle({ x: MARGEM, y: topo - altura, width: largura, height: altura, borderColor: rgb(0.78, 0.78, 0.78), borderWidth: 0.6 });
        for (let c = 1; c < colunas; c += 1) pagina.drawLine({ start: { x: MARGEM + c * larguraColuna, y: topo }, end: { x: MARGEM + c * larguraColuna, y: topo - altura }, thickness: 0.6, color: rgb(0.78, 0.78, 0.78) });
        y = topo - altura;
      };
      linhaDaTabela(bloco.cabecalho, true);
      for (const linha of bloco.linhas) linhaDaTabela(linha, false);
      y -= 10;
    } else if (bloco.tipo === "divisoria") {
      garantir(16);
      y -= 8;
      pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + largura, y }, thickness: 0.7, color: rgb(0.75, 0.75, 0.75) });
      y -= 8;
    }
  }

  if (opcoes.numerarPaginas) {
    const paginas = documento.getPages();
    paginas.forEach((p, indice) => {
      const texto = `${indice + 1} de ${paginas.length}`;
      p.drawText(texto, { x: (A4.largura - fontes.normal.widthOfTextAtSize(texto, 9)) / 2, y: 28, size: 9, font: fontes.normal, color: CINZA });
    });
  }
  produtor(documento, opcoes.titulo ? textoSeguro(opcoes.titulo) : undefined);
  return documento.save();
}

// --- ZIP para baixar várias saídas de uma vez -------------------------------------------

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP sem compressão (PDF e JPEG já vêm comprimidos): só índice e cópia dos bytes. */
export function criarZip(entradas: { nome: string; bytes: Uint8Array }[]) {
  const codificador = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  const usados = new Set<string>();
  for (const entrada of entradas) {
    let nome = entrada.nome.replace(/[\\/]/g, "-");
    for (let n = 2; usados.has(nome); n += 1) nome = entrada.nome.replace(/(\.[^.]+)?$/, ` (${n})$1`);
    usados.add(nome);
    const nomeBytes = codificador.encode(nome);
    const crc = crc32(entrada.bytes);
    const tamanho = entrada.bytes.byteLength;
    const local = new Uint8Array(30 + nomeBytes.length);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true); vl.setUint16(4, 20, true); vl.setUint16(6, 0x0800, true); vl.setUint16(8, 0, true);
    vl.setUint32(14, crc, true); vl.setUint32(18, tamanho, true); vl.setUint32(22, tamanho, true); vl.setUint16(26, nomeBytes.length, true);
    local.set(nomeBytes, 30);
    const central = new Uint8Array(46 + nomeBytes.length);
    const vc = new DataView(central.buffer);
    vc.setUint32(0, 0x02014b50, true); vc.setUint16(4, 20, true); vc.setUint16(6, 20, true); vc.setUint16(8, 0x0800, true); vc.setUint16(10, 0, true);
    vc.setUint32(16, crc, true); vc.setUint32(20, tamanho, true); vc.setUint32(24, tamanho, true); vc.setUint16(28, nomeBytes.length, true);
    vc.setUint32(42, deslocamento, true);
    central.set(nomeBytes, 46);
    locais.push(local, entrada.bytes);
    centrais.push(central);
    deslocamento += local.byteLength + tamanho;
  }
  const tamanhoCentral = centrais.reduce((soma, c) => soma + c.byteLength, 0);
  const fim = new Uint8Array(22);
  const vf = new DataView(fim.buffer);
  vf.setUint32(0, 0x06054b50, true); vf.setUint16(8, entradas.length, true); vf.setUint16(10, entradas.length, true);
  vf.setUint32(12, tamanhoCentral, true); vf.setUint32(16, deslocamento, true);
  const partes = [...locais, ...centrais, fim];
  const saida = new Uint8Array(partes.reduce((soma, p) => soma + p.byteLength, 0));
  let posicao = 0;
  for (const parte of partes) { saida.set(parte, posicao); posicao += parte.byteLength; }
  return saida;
}
