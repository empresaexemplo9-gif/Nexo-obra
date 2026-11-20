"use client";

import { ajustarParaTextoBranco, contraste, paletaCompleta, variaveisDaPaleta, type CoresDaMarca } from "@/lib/empresa-config";

// Preparação do logotipo no navegador. A empresa manda o que tiver — PNG, JPEG, WebP,
// SVG ou o PDF do manual da marca — e o servidor recebe sempre um bitmap pequeno: a
// primeira página do PDF vira imagem, SVG nunca chega ao servidor (poderia carregar
// script), as margens brancas são cortadas e as cores dominantes viram sugestão.

const LARGURA_MAX = 640;
const ALTURA_MAX = 320;
const BYTES_MAX = 380 * 1024;

export const tiposAceitos = ".png,.jpg,.jpeg,.webp,.svg,.gif,.bmp,.pdf,image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/bmp,application/pdf";

export type LogotipoPreparado = { base64: string; mime: "image/png" | "image/webp"; previewUrl: string; paleta: string[] };

async function carregarImagem(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const imagem = new Image();
    imagem.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      imagem.onload = () => resolve();
      imagem.onerror = () => reject(new Error("Não foi possível abrir esta imagem. Envie PNG, JPEG, WebP, SVG ou PDF."));
      imagem.src = url;
    });
    return imagem;
  } finally {
    // A imagem já decodificou; o endereço temporário pode sair.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function fonteDoArquivo(arquivo: File): Promise<Blob> {
  const ehPdf = arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name);
  if (!ehPdf) return arquivo;
  const { abrirPdfJs, paginaEmImagem } = await import("@/lib/pdfjs-client");
  const { documento, fechar } = await abrirPdfJs(new Uint8Array(await arquivo.arrayBuffer()));
  try { return (await paginaEmImagem(documento, 1, 150, "image/png")).blob; }
  finally { fechar(); }
}

function hex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Recorte do que não é fundo: ignora transparente e quase branco. */
function areaUtil(dados: Uint8ClampedArray, largura: number, altura: number) {
  let x0 = largura, y0 = altura, x1 = -1, y1 = -1;
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 4;
      const fundo = dados[i + 3] < 24 || (dados[i] > 244 && dados[i + 1] > 244 && dados[i + 2] > 244);
      if (fundo) continue;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, largura, altura };
  const margem = 4;
  const x = Math.max(0, x0 - margem), y = Math.max(0, y0 - margem);
  return { x, y, largura: Math.min(largura, x1 + margem + 1) - x, altura: Math.min(altura, y1 + margem + 1) - y };
}

/** Cores dominantes, das mais presentes para as menos, sem tons quase iguais. */
export function paletaDominante(dados: Uint8ClampedArray, limite = 5): string[] {
  const grupos = new Map<number, { n: number; r: number; g: number; b: number }>();
  const passo = Math.max(1, Math.floor(dados.length / 4 / 20_000));
  for (let p = 0; p < dados.length / 4; p += passo) {
    const i = p * 4;
    const [r, g, b, a] = [dados[i], dados[i + 1], dados[i + 2], dados[i + 3]];
    if (a < 128 || (r > 235 && g > 235 && b > 235)) continue;
    const chave = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const grupo = grupos.get(chave) ?? { n: 0, r: 0, g: 0, b: 0 };
    grupo.n += 1; grupo.r += r; grupo.g += g; grupo.b += b;
    grupos.set(chave, grupo);
  }
  const ordenados = [...grupos.values()].sort((a, b) => b.n - a.n).map((g) => [g.r / g.n, g.g / g.n, g.b / g.n] as const);
  const escolhidos: (readonly [number, number, number])[] = [];
  for (const cor of ordenados) {
    if (escolhidos.every((outra) => Math.hypot(cor[0] - outra[0], cor[1] - outra[1], cor[2] - outra[2]) > 60)) escolhidos.push(cor);
    if (escolhidos.length >= limite) break;
  }
  return escolhidos.map(([r, g, b]) => hex(r, g, b));
}

function saturacao(cor: string) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(cor.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function matiz(cor: string) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(cor.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function distanciaDeMatiz(a: string, b: string) {
  const d = Math.abs(matiz(a) - matiz(b));
  return Math.min(d, 360 - d);
}

function escurecer(cor: string, fator: number) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(cor.slice(i, i + 2), 16));
  return hex(r * fator, g * fator, b * fator);
}

/**
 * Das cores do logotipo, uma sugestão para as três posições da interface. A paleta chega
 * em ordem de presença no logotipo:
 *  - a cor de marca mais presente (com saturação) vira a cor principal, dos botões;
 *  - a segunda cor de marca, se houver, vira a faixa de destaque — é o que dá à interface
 *    as duas cores da marca, como no tema da H.OIKOS;
 *  - o menu fica com a cor mais escura do logotipo, ou com a principal bem escurecida.
 * Tudo passa pelo mesmo ajuste de leitura do servidor.
 */
export function sugerirCores(paleta: string[]) {
  if (!paleta.length) return null;
  const marcantes = paleta.filter((cor) => saturacao(cor) >= 0.25);
  const principal = marcantes[0] ?? paleta[0];
  // Outro matiz de verdade: o verde-escuro do texto de um logotipo verde não é segunda cor.
  const segunda = marcantes.find((cor) => distanciaDeMatiz(cor, principal) >= 30);
  const escura = paleta.find((cor) => cor !== principal && contraste(cor, "#ffffff") >= 9) ?? escurecer(principal, 0.32);
  return {
    accentColor: ajustarParaTextoBranco(principal),
    menuColor: ajustarParaTextoBranco(escura, 9),
    bandColor: ajustarParaTextoBranco(segunda ?? escurecer(principal, 0.7)),
  };
}

export async function prepararLogotipo(arquivo: File): Promise<LogotipoPreparado> {
  if (arquivo.size > 25 * 1024 * 1024) throw new Error("Arquivo acima de 25 MB. Envie o logotipo ou só a página da marca.");
  const imagem = await carregarImagem(await fonteDoArquivo(arquivo));
  const largura = imagem.naturalWidth || 800, altura = imagem.naturalHeight || 400;
  const fonte = document.createElement("canvas");
  // SVG sem tamanho declarado chega com 0; um limite generoso evita borrar.
  const escalaFonte = Math.min(1, 2400 / Math.max(largura, altura));
  fonte.width = Math.max(1, Math.round(largura * escalaFonte));
  fonte.height = Math.max(1, Math.round(altura * escalaFonte));
  const ctxFonte = fonte.getContext("2d", { willReadFrequently: true });
  if (!ctxFonte) throw new Error("Seu navegador não conseguiu preparar a imagem.");
  ctxFonte.drawImage(imagem, 0, 0, fonte.width, fonte.height);
  const tudo = ctxFonte.getImageData(0, 0, fonte.width, fonte.height).data;
  const area = areaUtil(tudo, fonte.width, fonte.height);

  const escala = Math.min(1, LARGURA_MAX / area.largura, ALTURA_MAX / area.altura);
  const saida = document.createElement("canvas");
  saida.width = Math.max(1, Math.round(area.largura * escala));
  saida.height = Math.max(1, Math.round(area.altura * escala));
  const ctx = saida.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, area.x, area.y, area.largura, area.altura, 0, 0, saida.width, saida.height);
  const paleta = paletaDominante(ctx.getImageData(0, 0, saida.width, saida.height).data);

  const gerar = (tipo: "image/png" | "image/webp", qualidade?: number) => new Promise<Blob>((resolve, reject) =>
    saida.toBlob((b) => b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem.")), tipo, qualidade));
  let blob = await gerar("image/png");
  let mime: "image/png" | "image/webp" = "image/png";
  if (blob.size > BYTES_MAX) { blob = await gerar("image/webp", 0.88); mime = "image/webp"; }
  if (blob.size > BYTES_MAX || blob.type !== mime) throw new Error("O logotipo continua grande demais. Envie uma versão mais simples da marca.");
  fonte.width = 0; fonte.height = 0;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(binario), mime, previewUrl: URL.createObjectURL(blob), paleta };
}

/** Aplica a paleta inteira da empresa às variáveis de que toda a interface deriva. */
export function aplicarCoresNaPagina(cores: CoresDaMarca | null | undefined) {
  const raiz = document.documentElement.style;
  const paleta = paletaCompleta(cores);
  for (const variavel of variaveisDaPaleta) {
    if (paleta[variavel]) raiz.setProperty(variavel, paleta[variavel]);
    else raiz.removeProperty(variavel);
  }
}
