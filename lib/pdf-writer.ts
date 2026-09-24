// Escritor de PDF mínimo, sem dependência.
//
// A Prancheta gera PDF de duas coisas: desenho (vetor puro: traços e áreas preenchidas)
// e imagem (a foto ou a página embutida sem perda). Para isso bastam páginas com um fluxo
// de conteúdo e, às vezes, uma imagem. Uma biblioteca de PDF inteira seria peso morto.
//
// Tudo aqui é determinístico e testável no Node: os deslocamentos da tabela xref são
// contados em bytes, não em caracteres, porque o título pode ter acento.

export type PdfImage = {
  name: string;
  width: number;
  height: number;
  data: Uint8Array;
  // DCTDecode: JPEG original, byte a byte. FlateDecode: RGB/cinza cru comprimido.
  filter: "DCTDecode" | "FlateDecode";
  colorSpace: "DeviceRGB" | "DeviceGray";
};

export type PdfPage = {
  /** Tamanho em pontos (1/72 pol). */
  width: number;
  height: number;
  content: Uint8Array;
  contentCompressed: boolean;
  images?: PdfImage[];
};

const encoder = new TextEncoder();

/** Texto de PDF em UTF-16BE com BOM: acento e cedilha saem certos em qualquer leitor. */
export function pdfText(value: string) {
  let hex = "FEFF";
  for (const unit of value) {
    const code = unit.codePointAt(0)!;
    if (code > 0xffff) {
      const offset = code - 0x10000;
      hex += (0xd800 + (offset >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (offset & 0x3ff)).toString(16).padStart(4, "0");
    } else hex += code.toString(16).padStart(4, "0");
  }
  return `<${hex.toUpperCase()}>`;
}

/** Número de PDF: sem notação científica, no máximo 3 casas. */
export function pdfNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function buildPdf(pages: PdfPage[], info: { title?: string } = {}): Uint8Array {
  if (!pages.length) throw new Error("PDF sem páginas.");
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes); length += bytes.byteLength;
  };
  // Objetos numerados na ordem: 1 catálogo, 2 árvore de páginas, 3 informações, depois
  // página, conteúdo e imagens de cada página.
  let next = 4;
  const plan = pages.map((page) => {
    const pageId = next++;
    const contentId = next++;
    const imageIds = (page.images ?? []).map(() => next++);
    return { page, pageId, contentId, imageIds };
  });
  const object = (id: number, body: string | Uint8Array[], dictionary?: string) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    if (typeof body === "string") push(body);
    else {
      push(`${dictionary}\nstream\n`);
      for (const piece of body) push(piece);
      push("\nendstream");
    }
    push("\nendobj\n");
  };

  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marca binária: o arquivo não é texto puro
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${plan.map((item) => `${item.pageId} 0 R`).join(" ")}] /Count ${plan.length} >>`);
  object(3, `<< /Producer ${pdfText("H.OIKOS Prancheta")}${info.title ? ` /Title ${pdfText(info.title)}` : ""} >>`);
  for (const { page, pageId, contentId, imageIds } of plan) {
    const xobjects = imageIds.length
      ? ` /XObject << ${(page.images ?? []).map((image, index) => `/${image.name} ${imageIds[index]} 0 R`).join(" ")} >>`
      : "";
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)}] /Resources <<${xobjects} >> /Contents ${contentId} 0 R >>`);
    object(contentId, [page.content], `<< /Length ${page.content.byteLength}${page.contentCompressed ? " /Filter /FlateDecode" : ""} >>`);
    (page.images ?? []).forEach((image, index) => {
      object(imageIds[index], [image.data], `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.byteLength} >>`);
    });
  }
  const xref = length;
  const total = next;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

/** Largura, altura e canais de um JPEG, lidos do marcador SOF. Nulo se não for JPEG. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // SOF0 a SOF15, exceto DHT (C4), JPG (C8) e DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8], components: bytes[offset + 9] };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * PDF de uma imagem, numa página do tamanho dela a 150 dpi. JPEG em RGB ou cinza entra
 * com os bytes originais; o resto chega já decodificado em RGB e vai comprimido sem perda.
 */
export async function pdfDeImagem(imagem: { tipo: "jpeg"; bytes: Uint8Array } | { tipo: "rgb"; rgb: Uint8Array; largura: number; altura: number }, titulo: string) {
  let image: PdfImage;
  if (imagem.tipo === "jpeg") {
    const info = jpegInfo(imagem.bytes);
    if (!info || ![1, 3].includes(info.components)) throw new Error("JPEG em CMYK ou inválido: decodifique antes.");
    image = { name: "Im0", width: info.width, height: info.height, data: imagem.bytes, filter: "DCTDecode", colorSpace: info.components === 1 ? "DeviceGray" : "DeviceRGB" };
  } else {
    if (imagem.rgb.byteLength !== imagem.largura * imagem.altura * 3) throw new Error("Imagem RGB com tamanho inconsistente.");
    image = { name: "Im0", width: imagem.largura, height: imagem.altura, data: await deflate(imagem.rgb), filter: "FlateDecode", colorSpace: "DeviceRGB" };
  }
  const width = image.width * 72 / 150, height = image.height * 72 / 150;
  const content = encoder.encode(`q ${pdfNumber(width)} 0 0 ${pdfNumber(height)} 0 0 cm /Im0 Do Q`);
  return buildPdf([{ width, height, content, contentCompressed: false, images: [image] }], { title: titulo });
}
