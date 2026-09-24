"use client";

import { buildPdf, deflate, larguraHelvetica, pdfNumber, textoWinAnsi, type PdfImage } from "@/lib/pdf-writer";
import { areaM2, limitesDoLayout, type LayoutConteudo } from "@/lib/layout";

// Imagens e prancha da proposta, geradas no navegador a partir do que está na tela.

function carregarImagem(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const imagem = new Image();
    imagem.onload = () => resolve(imagem);
    imagem.onerror = () => reject(new Error("Não foi possível desenhar a planta."));
    imagem.src = url;
  });
}

/**
 * Planta humanizada em PNG: a própria planta da tela, sem grade nem seleção, enquadrada
 * no desenho com uma margem e fundo branco.
 */
export async function plantaPng(svg: SVGSVGElement, doc: LayoutConteudo, largura = 3000) {
  const limites = limitesDoLayout(doc);
  if (!limites) throw new Error("A planta está vazia.");
  const margem = 800;
  const x = limites.minX - margem, y = limites.minY - margem;
  const w = limites.maxX - limites.minX + 2 * margem, h = limites.maxY - limites.minY + 2 * margem;
  const altura = Math.round((largura * h) / w);
  const copia = svg.cloneNode(true) as SVGSVGElement;
  copia.querySelectorAll("[data-overlay]").forEach((elemento) => elemento.remove());
  copia.querySelectorAll("[data-rotulo], [data-rotulo-area]").forEach((elemento) => elemento.removeAttribute("visibility"));
  copia.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  copia.setAttribute("width", String(largura)); copia.setAttribute("height", String(altura));
  copia.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copia.style.background = "#ffffff";
  // Os rótulos foram dimensionados para a tela; na imagem, para a largura exportada.
  const fator = (w / largura) / Math.max(Number(svg.viewBox.baseVal.width) / Math.max(svg.clientWidth, 1), 0.0001);
  copia.querySelectorAll("text").forEach((texto) => {
    for (const atributo of ["font-size", "stroke-width"]) {
      const valor = Number(texto.getAttribute(atributo));
      if (valor) texto.setAttribute(atributo, String(valor * fator * 1.4));
    }
  });
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copia)], { type: "image/svg+xml" }));
  try {
    const imagem = await carregarImagem(url);
    const canvas = document.createElement("canvas");
    canvas.width = largura; canvas.height = altura;
    const contexto = canvas.getContext("2d")!;
    contexto.fillStyle = "#ffffff"; contexto.fillRect(0, 0, largura, altura);
    contexto.drawImage(imagem, 0, 0, largura, altura);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar a imagem da planta.")), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

async function imagemPdf(blob: Blob, nome: string): Promise<PdfImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const contexto = canvas.getContext("2d")!;
  contexto.fillStyle = "#ffffff"; contexto.fillRect(0, 0, canvas.width, canvas.height);
  contexto.drawImage(bitmap, 0, 0); bitmap.close();
  const rgba = contexto.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
  return { name: nome, width: canvas.width, height: canvas.height, data: await deflate(rgb), filter: "FlateDecode", colorSpace: "DeviceRGB" };
}

/**
 * Prancha de proposta em A3 deitado: título, prévia 3D, planta humanizada, quadro de
 * áreas e o aviso de que a imagem é ilustrativa. Imagens sem perda; texto em fonte padrão.
 */
export async function pranchaPdf(opcoes: { titulo: string; subtitulo: string; empresa: string; doc: LayoutConteudo; imagem3d: Blob; planta: Blob }) {
  const W = 1190.55, H = 841.89, margem = 36;
  const [img3d, imgPlanta] = await Promise.all([imagemPdf(opcoes.imagem3d, "Im3D"), imagemPdf(opcoes.planta, "ImPl")]);
  const cmd: string[] = [];
  const texto = (conteudo: string, x: number, y: number, tamanho: number, negrito = false, cor = "0.17 0.16 0.14") =>
    cmd.push(`BT ${cor} rg /${negrito ? "F2" : "F1"} ${pdfNumber(tamanho)} Tf ${pdfNumber(x)} ${pdfNumber(y)} Td ${textoWinAnsi(conteudo)} Tj ET`);
  const encaixar = (imagem: PdfImage, x: number, y: number, w: number, h: number) => {
    const escala = Math.min(w / imagem.width, h / imagem.height);
    const iw = imagem.width * escala, ih = imagem.height * escala;
    cmd.push(`q ${pdfNumber(iw)} 0 0 ${pdfNumber(ih)} ${pdfNumber(x + (w - iw) / 2)} ${pdfNumber(y + (h - ih) / 2)} cm /${imagem.name} Do Q`);
  };
  // Cabeçalho
  cmd.push(`0.94 0.92 0.87 rg 0 ${pdfNumber(H - 78)} ${pdfNumber(W)} 78 re f`);
  texto(opcoes.titulo.slice(0, 80), margem, H - 44, 22, true);
  texto(opcoes.subtitulo.slice(0, 140), margem, H - 64, 11);
  const empresa = opcoes.empresa.slice(0, 60);
  texto(empresa, W - margem - larguraHelvetica(empresa, 11), H - 44, 11, true);
  const data = new Date().toLocaleDateString("pt-BR");
  texto(data, W - margem - larguraHelvetica(data, 10), H - 62, 10);
  // Imagens
  const topo = H - 78 - 18, base = 96;
  const larguraEsq = (W - 2 * margem) * 0.6;
  cmd.push(`0.85 0.83 0.78 RG 0.8 w ${pdfNumber(margem)} ${pdfNumber(base)} ${pdfNumber(larguraEsq)} ${pdfNumber(topo - base)} re S`);
  encaixar(img3d, margem + 4, base + 4, larguraEsq - 8, topo - base - 8);
  const xDir = margem + larguraEsq + 18, larguraDir = W - margem - xDir;
  cmd.push(`${pdfNumber(xDir)} ${pdfNumber(base)} ${pdfNumber(larguraDir)} ${pdfNumber(topo - base)} re S`);
  encaixar(imgPlanta, xDir + 4, base + 4, larguraDir - 8, topo - base - 8);
  texto("Prévia 3D", margem, base - 16, 9, true, "0.4 0.37 0.32");
  texto("Planta humanizada", xDir, base - 16, 9, true, "0.4 0.37 0.32");
  // Quadro de áreas
  const areas = opcoes.doc.comodos.filter((c) => c.nome).map((c) => `${c.nome}: ${areaM2(c.pontos).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`);
  const total = opcoes.doc.comodos.reduce((soma, c) => soma + areaM2(c.pontos), 0);
  const linhaAreas = [...areas, `Total: ${total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`].join("   ·   ");
  texto(linhaAreas.slice(0, 190), margem, 52, 9);
  texto("Imagem ilustrativa para estudo e proposta. Móveis, veículos e acabamentos são representações; medidas e especificações serão confirmadas no projeto executivo.", margem, 30, 8, false, "0.45 0.42 0.37");
  const conteudo = await deflate(new TextEncoder().encode(cmd.join("\n")));
  return buildPdf([{ width: W, height: H, content: conteudo, contentCompressed: true, images: [img3d, imgPlanta], fonts: true }], { title: opcoes.titulo });
}
