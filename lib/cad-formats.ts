import { documentoSchema, Documento } from "@/lib/prancheta";

export type FormatCapability = "nativo" | "aberto" | "conversor" | "planejado";
export type CadFormat = {
  id: string; label: string; extensions: readonly string[]; capability: FormatCapability;
  read: boolean; write: boolean; editable: boolean; is3D: boolean; note: string;
};

export const CAD_FORMATS: readonly CadFormat[] = [
  { id: "nexo", label: "Documento Nexo", extensions: [".nexo"], capability: "nativo", read: true, write: true, editable: true, is3D: false, note: "Formato nativo versionado." },
  { id: "dxf", label: "AutoCAD DXF", extensions: [".dxf"], capability: "aberto", read: true, write: true, editable: true, is3D: false, note: "DXF ASCII com relatório de avisos." },
  { id: "dwg", label: "AutoCAD DWG", extensions: [".dwg"], capability: "conversor", read: true, write: false, editable: true, is3D: false, note: "Requer conversor DWG configurado no servidor." },
  { id: "svg", label: "SVG", extensions: [".svg"], capability: "aberto", read: false, write: true, editable: false, is3D: false, note: "Exportação vetorial disponível." },
  { id: "ifc", label: "IFC", extensions: [".ifc"], capability: "planejado", read: false, write: false, editable: false, is3D: true, note: "Adaptador BIM planejado." },
  { id: "step", label: "STEP", extensions: [".step", ".stp"], capability: "planejado", read: false, write: false, editable: false, is3D: true, note: "Adaptador OpenCascade planejado." },
  { id: "gltf", label: "glTF/GLB", extensions: [".gltf", ".glb"], capability: "planejado", read: false, write: false, editable: false, is3D: true, note: "Visualização 3D planejada." },
] as const;

export function detectCadFormat(name: string, bytes: Uint8Array): CadFormat | null {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 128)).trimStart();
  if (/^AC10\d{2}/.test(head)) return CAD_FORMATS.find((format) => format.id === "dwg") ?? null;
  if (head.startsWith("0\nSECTION") || head.startsWith("0\r\nSECTION")) return CAD_FORMATS.find((format) => format.id === "dxf") ?? null;
  if (head.startsWith("{") && (head.includes('"format":"nexo"') || head.includes('"format": "nexo"'))) return CAD_FORMATS.find((format) => format.id === "nexo") ?? null;
  const extension = `.${name.split(".").pop()?.toLowerCase() ?? ""}`;
  return CAD_FORMATS.find((format) => format.extensions.includes(extension)) ?? null;
}

export function exportNexo(document: Documento): string {
  return JSON.stringify({ format: "nexo", version: 1, document });
}

export function importNexo(source: string): Documento {
  const envelope = JSON.parse(source) as { format?: unknown; version?: unknown; document?: unknown };
  if (envelope.format !== "nexo" || envelope.version !== 1) throw new Error("Versão de documento Nexo não suportada.");
  return documentoSchema.parse(envelope.document);
}
