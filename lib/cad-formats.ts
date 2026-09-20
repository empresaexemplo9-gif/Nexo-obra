import { z } from "zod";
import { documentoSchema, type Documento, type Camada, type Elemento } from "@/lib/prancheta";
import { lerDxf, versaoDoDwg, type Unidade } from "@/lib/integrations/dxf";

export const MAX_CAD_BYTES = 12 * 1024 * 1024;
export type ImportReport = { format: string; imported: number; discarded: number; warnings: string[] };
export type CadImport = { camadas: Camada[]; elementos: Elemento[]; unidade: Unidade; unidadeDeclarada: boolean; avisos: string[]; truncado: boolean; report: ImportReport };
export type FormatAdapter = {
  id: string; label: string; extensions: string[];
  detect: (head: Uint8Array) => number;
  import: (bytes: Uint8Array, unit?: Unidade) => CadImport | Promise<CadImport>;
  capabilities: { read: boolean; write: boolean; editable: boolean; is3D: boolean };
};
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export class FormatRegistry {
  private adapters: FormatAdapter[] = [];
  register(adapter: FormatAdapter) {
    if (this.adapters.some((a) => a.id === adapter.id)) throw new Error(`Adaptador duplicado: ${adapter.id}`);
    this.adapters.push(adapter);
    return this;
  }
  detect(bytes: Uint8Array) {
    return this.adapters.map((adapter) => ({ adapter, score: adapter.detect(bytes.subarray(0, 65536)) }))
      .filter((a) => a.score > 0).sort((a, b) => b.score - a.score)[0]?.adapter;
  }
  async import(bytes: Uint8Array, unit?: Unidade): Promise<CadImport> {
    if (!bytes.length) throw new Error("O arquivo está vazio.");
    if (bytes.length > MAX_CAD_BYTES) throw new Error("O arquivo pode ter no máximo 12 MB.");
    const adapter = this.detect(bytes);
    if (!adapter) throw new Error("Formato não reconhecido pelo conteúdo. Consulte /formatos para ver as alternativas de conversão.");
    return adapter.import(bytes, unit);
  }
}

const nativeSchema = z.object({ format: z.literal("nexo"), version: z.literal(1), unit: z.literal("mm").default("mm"), document: documentoSchema }).strict();
export function exportNative(document: Documento): string {
  return JSON.stringify(nativeSchema.parse({ format: "nexo", version: 1, unit: "mm", document }));
}
export const exportNexo = exportNative;
export function importNexo(source: string): Documento {
  const parsed = nativeSchema.parse(JSON.parse(source));
  checkReferences(parsed.document);
  return parsed.document;
}
export function detectCadFormat(_name: string, bytes: Uint8Array) { return createFormatRegistry().detect(bytes) ?? null; }
function checkReferences(document: Documento) {
  const layers = new Set(document.camadas.map((c) => c.id));
  if (layers.size !== document.camadas.length || new Set(document.elementos.map((e) => e.id)).size !== document.elementos.length) throw new Error("O arquivo contém identificadores duplicados.");
  if (document.elementos.some((e) => !layers.has(e.camada))) throw new Error("O arquivo contém elementos sem camada.");
  // Native documents cannot smuggle foreign URLs or cross-tenant media paths.
  if (document.fundo || document.elementos.some((e) => "chave" in e && e.chave)) throw new Error("Este arquivo referencia imagens privadas. Remova as imagens antes de importar e reinsira-as pela biblioteca desta organização.");
}
export const nativeAdapter: FormatAdapter = {
  id: "nexo", label: "Documento Nexo v1", extensions: ["nexo"],
  capabilities: { read: true, write: true, editable: true, is3D: false },
  detect: (head) => /^\s*\{/.test(decode(head)) && /"format"\s*:\s*"nexo"/.test(decode(head)) ? 1 : 0,
  import(bytes) {
    const parsed = nativeSchema.safeParse(JSON.parse(decode(bytes)));
    if (!parsed.success) throw new Error("Documento Nexo inválido ou versão ainda não suportada.");
    const document = parsed.data.document;
    checkReferences(document);
    const avisos = ["A importação traz a geometria e as camadas. Folha, escala e malha permanecem as da prancha de destino."];
    return { camadas: document.camadas, elementos: document.elementos, unidade: "mm", unidadeDeclarada: true, avisos, truncado: false, report: { format: "nexo", imported: document.elementos.length, discarded: 0, warnings: avisos } };
  },
};
export const dxfAdapter: FormatAdapter = {
  id: "dxf", label: "DXF ASCII", extensions: ["dxf"],
  capabilities: { read: true, write: true, editable: true, is3D: false },
  detect: (head) => /(?:^|\r?\n)\s*0\s*\r?\nSECTION\s*(?:\r?\n)/i.test(decode(head)) ? 0.95 : 0,
  import(bytes, unit) {
    const result = lerDxf(decode(bytes), unit ? { unidade: unit } : {});
    return { ...result, report: { format: "dxf", imported: result.elementos.length, discarded: Object.values(result.ignorados).reduce((a, b) => a + b, 0), warnings: result.avisos } };
  },
};
export function createFormatRegistry(convertDwg?: (bytes: Uint8Array) => Promise<string>) {
  return new FormatRegistry().register(nativeAdapter).register(dxfAdapter).register({
    id: "dwg", label: "DWG via conversor", extensions: ["dwg"],
    capabilities: { read: Boolean(convertDwg), write: false, editable: true, is3D: false },
    detect: (head) => versaoDoDwg(head) ? 1 : 0,
    async import(bytes, unit) {
      if (!convertDwg) throw new Error("Conversor DWG não configurado. Exporte como DXF ASCII no programa de origem.");
      const converted = await convertDwg(bytes);
      const result = await dxfAdapter.import(new TextEncoder().encode(converted), unit);
      const warnings = ["DWG convertido para DXF pelo serviço configurado. Confira a fidelidade antes de salvar.", ...result.avisos];
      return { ...result, avisos: warnings, report: { ...result.report, format: "dwg", warnings } };
    },
  });
}

/** Merge is atomic: remap all ids and never add content to a locked destination layer. */
export function mergeCadImport(document: Documento, imported: Pick<CadImport, "camadas" | "elementos">, id: () => string = () => crypto.randomUUID()): Documento {
  const layerMap = new Map<string, string>();
  const used = new Set([...document.camadas.map((c) => c.id), ...document.elementos.map((e) => e.id)]);
  const unique = () => { const value = id(); if (used.has(value)) throw new Error("Identificador de importação duplicado."); used.add(value); return value; };
  const layers = imported.camadas.map((layer) => {
    if (layerMap.has(layer.id)) throw new Error("Camadas duplicadas no arquivo.");
    const layerId = unique(); layerMap.set(layer.id, layerId);
    return { ...layer, id: layerId };
  });
  const elements = imported.elementos.map((element) => {
    const layer = layerMap.get(element.camada);
    if (!layer) throw new Error("Elemento sem camada no arquivo.");
    return { ...element, id: unique(), camada: layer };
  });
  const result = documentoSchema.safeParse({ ...document, camadas: [...document.camadas, ...layers], elementos: [...document.elementos, ...elements] });
  if (!result.success) throw new Error("A importação excede os limites da prancha (60 camadas ou 20 mil elementos). Use uma prancha nova.");
  return result.data;
}

export const FORMAT_SUPPORT = [
  ["NEXO v1", "Leitura e exportação 2D", "Geometria e camadas; imagens privadas devem ser reinseridas pela biblioteca."],
  ["DXF ASCII", "Leitura e exportação 2D", "Subconjunto de entidades; perdas indicadas no relatório. DXF binário não suportado."],
  ["DWG", "Leitura com conversor", "Exige serviço DWG configurado pelo administrador. Alternativa: DXF ASCII."],
  ["SVG", "Exportação", "Para importar, converta para DXF. A importação SVG ainda não está implementada."],
  ["PDF, HPGL/PLT, CGM, EMF/WMF", "Não suportados como geometria", "Converta para DXF em uma ferramenta externa."],
  ["DGN, DWF/DWFx", "Não suportados", "Converta para DXF com ferramenta licenciada."],
  ["STEP, IGES, STL, OBJ, PLY, 3MF, glTF/GLB, DAE, 3DS, VRML/X3D, FBX, 3DM", "3D pendente", "Exporte uma vista 2D em DXF no programa de origem."],
  ["IFC, RVT/RFA, SKP, NWD/NWC", "BIM pendente", "Exporte uma vista 2D em DXF no programa de origem."],
  ["SAT/ACIS, Parasolid, JT, CATIA, SolidWorks, Inventor", "Não suportados", "Requerem SDK ou serviço licenciado; conectores ainda não implementados."],
  ["GeoJSON, Shapefile, KML/KMZ, GML, GeoPackage, GPX, LandXML, DEM/GeoTIFF, CSV/TXT", "GIS pendente", "Converta previamente para DXF em coordenadas locais e confira a unidade."],
  ["LAS/LAZ, E57, XYZ/PTS, RCP/RCS", "Nuvem de pontos pendente", "Gere planta ou seção 2D no programa de origem."],
  ["PNG, JPG, WebP", "Referência pela biblioteca", "Inserção como imagem; sem vetorização automática."],
  ["TIFF, BMP, GIF", "Não suportados diretamente", "Converta para PNG ou JPG para usar na biblioteca."],
  ["SHX, TTF/OTF, LIN, PAT, CTB/STB, ASE, DWT", "Recursos auxiliares pendentes", "Incorpore ou converta os recursos no software de origem."],
] as const;
