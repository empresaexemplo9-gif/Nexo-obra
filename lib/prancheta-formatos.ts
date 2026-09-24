// Como a Prancheta trata cada formato: qual visualizador abre e quais conversões oferece.
//
// A extensão escolhe o visualizador; o visualizador confere o conteúdo e diz quando não
// consegue ler. Formato que o navegador não abre fica guardado e trafega no original,
// com o motivo dito na tela — nunca uma prévia inventada.

export type Visualizador = "cad" | "pdf" | "imagem" | "documento" | "planilha" | "modelo3d" | "video" | "audio" | "texto" | "nenhum";

const POR_EXTENSAO: Record<string, Visualizador> = {
  dwg: "cad", dxf: "cad",
  pdf: "pdf",
  png: "imagem", jpg: "imagem", jpeg: "imagem", webp: "imagem", gif: "imagem", bmp: "imagem", avif: "imagem", svg: "imagem",
  docx: "documento",
  xlsx: "planilha", csv: "planilha",
  stl: "modelo3d", obj: "modelo3d", glb: "modelo3d", gltf: "modelo3d", ply: "modelo3d", "3mf": "modelo3d", ifc: "modelo3d",
  mp4: "video", webm: "video", mov: "video",
  mp3: "audio", wav: "audio", m4a: "audio", ogg: "audio",
  txt: "texto", json: "texto", xml: "texto", ies: "texto", ldt: "texto", geojson: "texto", kml: "texto",
  step: "texto", stp: "texto", md: "texto", log: "texto", bc3: "texto", gpx: "texto", landxml: "texto",
};

export function visualizadorPara(extensao: string): Visualizador {
  return POR_EXTENSAO[extensao.toLowerCase()] ?? "nenhum";
}

/** O que dizer quando o formato não abre no navegador. Específico, porque o motivo muda. */
export function motivoSemVisualizacao(extensao: string) {
  const e = extensao.toLowerCase();
  if (["rvt", "rfa", "rte", "nwd", "nwc"].includes(e)) return "Revit e Navisworks só abrem com software da Autodesk. Para ver aqui, exporte do Revit em IFC, DWG ou PDF.";
  if (["skp"].includes(e)) return "SketchUp não abre no navegador. Para ver aqui, exporte do SketchUp em DWG, OBJ, glTF ou PDF.";
  if (["pln", "pla", "tpl"].includes(e)) return "ArchiCAD não abre no navegador. Para ver aqui, exporte em IFC, DWG ou PDF.";
  if (["dgn", "dwf", "dwfx"].includes(e)) return "DGN e DWF não abrem no navegador. Para ver aqui, exporte em DWG, DXF ou PDF.";
  if (["doc", "xls", "ppt", "pptx", "odt", "ods", "odp"].includes(e)) return "Este formato do Office não abre no navegador. Para ver aqui, salve como DOCX, XLSX ou PDF.";
  if (["tif", "tiff", "heic"].includes(e)) return "O navegador não exibe TIFF nem HEIC. Para ver aqui, converta para PNG ou JPG.";
  if (["zip", "rar", "7z"].includes(e)) return "Arquivo compactado: baixe para abrir.";
  if (["e57", "las", "laz", "rcp", "rcs", "pts", "xyz"].includes(e)) return "Nuvem de pontos não abre no navegador. Gere uma planta ou seção no programa de origem.";
  return "Este formato não tem visualização no navegador.";
}

export type Conversao = { id: "dwg-dxf" | "dxf-pdf" | "dxf-svg" | "dxf-png" | "pdf-png" | "pdf-jpg" | "imagem-pdf"; rotulo: string; descricao: string };

export const CONVERSOES: Record<Conversao["id"], Conversao> = {
  "dwg-dxf": { id: "dwg-dxf", rotulo: "DXF", descricao: "Arquivo DXF completo, convertido do DWG pelo LibreDWG. Abre em qualquer programa de CAD." },
  "dxf-pdf": { id: "dxf-pdf", rotulo: "PDF vetorial", descricao: "Folha A4 a A0 com as camadas visíveis, em vetor. Dá para imprimir em escala e ampliar sem perder definição." },
  "dxf-svg": { id: "dxf-svg", rotulo: "SVG", descricao: "Vetor nas unidades do desenho, para editar no Illustrator, Inkscape ou Figma." },
  "dxf-png": { id: "dxf-png", rotulo: "PNG", descricao: "Imagem em alta resolução, com fundo branco." },
  "pdf-png": { id: "pdf-png", rotulo: "PNG", descricao: "Uma imagem por página, em 200 dpi." },
  "pdf-jpg": { id: "pdf-jpg", rotulo: "JPG", descricao: "Uma imagem por página, em 200 dpi, mais leve que o PNG." },
  "imagem-pdf": { id: "imagem-pdf", rotulo: "PDF", descricao: "A imagem sem perda de qualidade numa página do mesmo tamanho." },
};

export function conversoesPara(extensao: string): Conversao["id"][] {
  const e = extensao.toLowerCase();
  if (e === "dwg") return ["dwg-dxf", "dxf-pdf", "dxf-svg", "dxf-png"];
  if (e === "dxf") return ["dxf-pdf", "dxf-svg", "dxf-png"];
  if (e === "pdf") return ["pdf-png", "pdf-jpg"];
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(e)) return ["imagem-pdf"];
  return [];
}

export const FORMATOS_ACEITOS_RESUMO = "DWG, DXF, PDF, IFC, imagens, Office, 3D (STL, OBJ, glTF), vídeo e qualquer outro arquivo de projeto";
