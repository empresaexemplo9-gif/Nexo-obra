"use client";

import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import type { ItemTexto } from "@/lib/markdown-doc";

// Leitura de PDF no navegador para a aba Documentos e PDF: miniaturas, páginas em imagem
// e texto. Mesmo build "legacy" e mesmos recursos do visualizador da Prancheta.

const VENDOR = "/vendor/pdfjs";
const MAX_PIXELS = 16_000_000;

/** Abre o PDF; `fechar` encerra o worker e libera a memória quando a tarefa acaba. */
export async function abrirPdfJs(bytes: Uint8Array): Promise<{ documento: PDFDocumentProxy; fechar: () => void }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdf.worker.min.mjs`;
  // O pdf.js transfere o buffer para o worker; a cópia preserva os bytes de quem chamou.
  const tarefa = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${VENDOR}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${VENDOR}/standard_fonts/`, wasmUrl: `${VENDOR}/wasm/`, iccUrl: `${VENDOR}/iccs/`,
  });
  try { return { documento: await tarefa.promise, fechar: () => { void tarefa.destroy(); } }; }
  catch (causa) {
    void tarefa.destroy();
    const texto = causa instanceof Error ? causa.message : "";
    throw new Error(/password/i.test(texto) ? "Este PDF tem senha. Remova a senha no programa de origem e envie de novo." : "O arquivo não é um PDF válido ou está corrompido.");
  }
}

/** Página em imagem. `dpi` define a nitidez; o limite de pixels protege o navegador. */
export async function paginaEmImagem(documento: PDFDocumentProxy, numero: number, dpi: number, tipo: "image/png" | "image/jpeg", qualidade = 0.9) {
  const pagina = await documento.getPage(numero);
  const base = pagina.getViewport({ scale: 1 });
  let escala = dpi / 72;
  if (base.width * base.height * escala * escala > MAX_PIXELS) escala = Math.sqrt(MAX_PIXELS / (base.width * base.height));
  const viewport = pagina.getViewport({ scale: escala });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await pagina.render({ canvas, viewport, background: "#ffffff" }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem.")), tipo, qualidade));
  canvas.width = 0; canvas.height = 0;
  return { blob, largura: base.width, altura: base.height };
}

/** Itens de texto com posição e altura da letra, para reconstruir as linhas. */
export async function textoDasPaginas(documento: PDFDocumentProxy) {
  const paginas: ItemTexto[][] = [];
  for (let numero = 1; numero <= documento.numPages; numero += 1) {
    const pagina = await documento.getPage(numero);
    const conteudo = await pagina.getTextContent();
    const itens: ItemTexto[] = [];
    for (const item of conteudo.items) {
      if (!("str" in item) || !item.str) continue;
      const [, , , d, x, y] = item.transform as number[];
      itens.push({ texto: item.str, x, y, altura: Math.abs(item.height || d) });
    }
    paginas.push(itens);
  }
  return paginas;
}
