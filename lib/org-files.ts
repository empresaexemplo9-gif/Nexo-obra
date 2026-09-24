// Regras de arquivo compartilhadas pelo navegador e pelo servidor.
//
// O navegador usa as mesmas constantes para partir o arquivo e para avisar antes de
// enviar; o servidor as usa para recusar. Uma regra só, dos dois lados.

/** 3 MiB: a parte cifrada e o cabeçalho cabem com folga no limite de 4,5 MB da função. */
export const FILE_CHUNK_BYTES = 3 * 1024 * 1024;
export const MAX_ORG_FILE_BYTES = 150 * 1024 * 1024;
export const MAX_ORG_FILE_LABEL = "150 MB";

// Executável e script não trafegam pela plataforma: quem recebe um anexo abre o que
// recebeu, e um .exe com nome de planta é o golpe mais velho que existe. Todo o resto
// vai e volta como foi enviado.
const BLOCKED_EXTENSIONS = new Set([
  "exe", "msi", "msp", "bat", "cmd", "com", "scr", "pif", "cpl", "vbs", "vbe", "js", "jse",
  "wsf", "wsh", "ps1", "psm1", "hta", "lnk", "reg", "jar", "apk", "app", "dmg", "pkg",
  "sh", "bash", "run", "bin", "dll", "sys", "gadget", "inf", "msc", "application",
]);

export function extensionOf(name: string) {
  const match = /\.([a-z0-9]{1,12})$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export function blockedExtension(name: string) {
  // "planta.pdf.exe" mostra .pdf a quem lê rápido: vale a última extensão.
  return BLOCKED_EXTENSIONS.has(extensionOf(name));
}

export function safeFileName(value: string) {
  return value.replaceAll("\\", "/").split("/").at(-1)!
    .replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 180) || "arquivo";
}

// Tipo pela extensão para os formatos técnicos, que quase sempre chegam sem tipo do
// navegador. O tipo só orienta o visualizador; a leitura confere a assinatura dos bytes.
const MIME_BY_EXTENSION: Record<string, string> = {
  dwg: "image/vnd.dwg", dxf: "image/vnd.dxf", dwf: "model/vnd.dwf", dgn: "application/octet-stream",
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv", txt: "text/plain", json: "application/json", xml: "application/xml",
  ifc: "application/x-step", step: "application/step", stp: "application/step",
  stl: "model/stl", obj: "model/obj", gltf: "model/gltf+json", glb: "model/gltf-binary", ply: "application/octet-stream",
  "3mf": "model/3mf", skp: "application/vnd.sketchup.skp", rvt: "application/octet-stream", rfa: "application/octet-stream",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  ies: "text/plain", ldt: "text/plain", kml: "application/vnd.google-earth.kml+xml", kmz: "application/vnd.google-earth.kmz",
  geojson: "application/geo+json",
};

export function mimeFor(name: string, declared?: string | null) {
  const extension = extensionOf(name);
  const known = MIME_BY_EXTENSION[extension];
  // O tipo declarado pelo navegador só vale se for plausível; texto livre não vira cabeçalho.
  const clean = declared && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(declared) ? declared.toLowerCase() : "";
  if (known && (!clean || clean === "application/octet-stream")) return known;
  return clean || known || "application/octet-stream";
}

export function chunkCountFor(size: number) {
  return Math.max(1, Math.ceil(size / FILE_CHUNK_BYTES));
}

export function expectedChunkSize(size: number, index: number) {
  const count = chunkCountFor(size);
  if (index < 0 || index >= count) return -1;
  return index < count - 1 ? FILE_CHUNK_BYTES : size - FILE_CHUNK_BYTES * (count - 1);
}

export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export const CONVERSION_LABELS: Record<string, string> = {
  "dwg-dxf": "DWG → DXF",
  "dxf-pdf": "Desenho → PDF",
  "dxf-svg": "Desenho → SVG",
  "dxf-png": "Desenho → PNG",
  "pdf-png": "PDF → PNG",
  "pdf-jpg": "PDF → JPG",
  "imagem-pdf": "Imagem → PDF",
};
