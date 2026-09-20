import { Documento, Elemento, moverElemento, camadaBloqueada, documentoSchema } from "@/lib/prancheta";
import { Ponto } from "@/lib/prancheta-cad";
import { normalizeDegrees, rotatePoint, scalePoint } from "@/packages/cad-core";

export const CAD_ALIASES = ["L", "C", "M", "CO", "RO", "SC", "E", "Z", "REDO"] as const;
export type CadAlias = typeof CAD_ALIASES[number];

export type CadCommandContext = {
  document: Documento;
  selectedId: string | null;
  layerId: string;
  createId: () => string;
};

export type CadCommandResult = { document: Documento; selectedId: string | null; message: string };

const number = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

function point(value: string | undefined): Ponto | null {
  if (!value) return null;
  const [x, y, extra] = value.replace(/^@/, "").split(",");
  if (extra !== undefined) return null;
  const px = number(x); const py = number(y);
  return px === null || py === null ? null : { x: px, y: -py || 0 };
}

function mapPoint(element: Elemento, transform: (point: Ponto) => Ponto): Elemento {
  if (element.tipo === "parede" || element.tipo === "cota") return { ...element, a: transform(element.a), b: transform(element.b) };
  if (element.tipo === "comodo" || element.tipo === "traco") return { ...element, pontos: element.pontos.map(transform) };
  if (element.tipo === "arco") return { ...element, centro: transform(element.centro) };
  return { ...element, posicao: transform(element.posicao) };
}

function requireSelected(context: CadCommandContext): Elemento {
  const selected = context.document.elementos.find((item) => item.id === context.selectedId);
  if (!selected) throw new Error("Selecione um elemento antes de executar este comando.");
  return selected;
}

function runCommand(input: string, context: CadCommandContext): CadCommandResult {
  const tokens = input.trim().split(/\s+/);
  const alias = (tokens.shift() ?? "").toUpperCase() as CadAlias;
  if (!CAD_ALIASES.includes(alias)) throw new Error(`Comando desconhecido: ${alias || "vazio"}.`);
  const document = context.document;

  if ((alias === "L" || alias === "C") && camadaBloqueada(document, context.layerId)) throw new Error("A camada está bloqueada.");
  if (alias === "L") {
    const a = point(tokens[0]); const b = point(tokens[1]);
    if (!a || !b) throw new Error("Use: L x1,y1 x2,y2");
    const id = context.createId();
    return { document: { ...document, elementos: [...document.elementos, { id, camada: context.layerId, tipo: "parede", a, b, espessuraMm: 150 }] }, selectedId: id, message: "Linha criada." };
  }
  if (alias === "C") {
    const centro = point(tokens[0]); const raio = number(tokens[1]);
    if (!centro || raio === null || raio <= 0) throw new Error("Use: C x,y raio");
    const id = context.createId();
    return { document: { ...document, elementos: [...document.elementos, { id, camada: context.layerId, tipo: "arco", centro, raioMm: raio, inicioGraus: 0, varreduraGraus: 360, espessuraMm: 20 }] }, selectedId: id, message: "Círculo criado." };
  }
  if (alias === "E") return { document, selectedId: null, message: "Seleção cancelada." };
  if (alias === "Z" || alias === "REDO") return { document, selectedId: context.selectedId, message: alias === "Z" ? "Use os controles de zoom da Prancheta." : "Use o botão Refazer." };
  const selected = requireSelected(context);
  if (camadaBloqueada(document, selected.camada)) throw new Error("A camada selecionada está bloqueada.");
  if (alias === "M" || alias === "CO") {
    const offset = point(tokens[0]);
    if (!offset) throw new Error(`Use: ${alias} dx,dy`);
    const moved = moverElemento(selected, offset.x, offset.y, 1);
    if (alias === "M") return { document: { ...document, elementos: document.elementos.map((item) => item.id === selected.id ? moved : item) }, selectedId: selected.id, message: "Elemento movido." };
    const copy = { ...moved, id: context.createId() };
    return { document: { ...document, elementos: [...document.elementos, copy] }, selectedId: copy.id, message: "Cópia criada." };
  }
  if (alias === "RO") {
    const center = point(tokens[0]); const degrees = number(tokens[1]);
    if (!center || degrees === null) throw new Error("Use: RO x,y graus");
    let changed = mapPoint(selected, (value) => rotatePoint(value, center, degrees));
    if ("rotacaoGraus" in changed) changed = { ...changed, rotacaoGraus: normalizeDegrees(changed.rotacaoGraus - degrees) };
    if (changed.tipo === "arco") changed = { ...changed, inicioGraus: normalizeDegrees(changed.inicioGraus + degrees) };
    return { document: { ...document, elementos: document.elementos.map((item) => item.id === selected.id ? changed : item) }, selectedId: selected.id, message: "Elemento rotacionado." };
  }
  if (alias === "SC") {
    const center = point(tokens[0]); const factor = number(tokens[1]);
    if (!center || factor === null || factor <= 0) throw new Error("Use: SC x,y fator");
    let changed = mapPoint(selected, (value) => scalePoint(value, center, factor));
    if ("larguraMm" in changed) changed = { ...changed, larguraMm: changed.larguraMm * factor };
    if ("alturaMm" in changed) changed = { ...changed, alturaMm: changed.alturaMm * factor };
    if ("espessuraMm" in changed) changed = { ...changed, espessuraMm: changed.espessuraMm * factor };
    if (changed.tipo === "arco") changed = { ...changed, raioMm: changed.raioMm * factor };
    if (changed.tipo === "cota") changed = { ...changed, deslocamentoMm: changed.deslocamentoMm * factor };
    return { document: { ...document, elementos: document.elementos.map((item) => item.id === selected.id ? changed : item) }, selectedId: selected.id, message: "Elemento escalado." };
  }
  return { document, selectedId: context.selectedId, message: alias === "Z" ? "Use os controles de zoom da Prancheta." : "Use o botão Refazer." };
}


// Reject invalid geometry before it reaches editor history or persistent storage.
export function executeCadCommand(input: string, context: CadCommandContext): CadCommandResult {
  const result = runCommand(input, context);
  if (!documentoSchema.safeParse(result.document).success) {
    throw new Error("O comando excede os limites de medidas ou de elementos do desenho.");
  }
  return result;
}
