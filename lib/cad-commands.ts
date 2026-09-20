import { Documento, Elemento, camadaBloqueada, documentoSchema } from "@/lib/prancheta";
import { Ponto, aparar, estender, espelhar, paralelaDe, segmentosDo } from "@/lib/prancheta-cad";
import { normalizeDegrees, rotatePoint, scalePoint } from "@/packages/cad-core";

export const CAD_ALIASES = [
  "L", "LINE",
  "PL", "PLINE", "POLYLINE",
  "C", "CIRCLE",
  "M", "MOVE",
  "CO", "COPY",
  "RO", "ROTATE",
  "SC", "SCALE",
  "O", "OFFSET",
  "MI", "MIRROR",
  "TR", "TRIM",
  "EX", "EXTEND",
  "DIM", "DIMENSION",
  "E", "ERASE",
  "Z", "REDO",
] as const;
export type CadAlias = typeof CAD_ALIASES[number];

export type CadCommandContext = {
  document: Documento;
  selectedId: string | null;
  layerId: string;
  createId: () => string;
};

export type CadCommandResult = { document: Documento; selectedId: string | null; message: string };

const ALIAS_MAP: Record<string, CadAlias> = {
  L: "L",
  LINE: "LINE",
  PL: "PL",
  PLINE: "PLINE",
  POLYLINE: "POLYLINE",
  C: "C",
  CIRCLE: "CIRCLE",
  M: "M",
  MOVE: "MOVE",
  CO: "CO",
  COPY: "COPY",
  RO: "RO",
  ROTATE: "ROTATE",
  SC: "SC",
  SCALE: "SCALE",
  O: "O",
  OFFSET: "OFFSET",
  MI: "MI",
  MIRROR: "MIRROR",
  TR: "TR",
  TRIM: "TRIM",
  EX: "EX",
  EXTEND: "EXTEND",
  DIM: "DIM",
  DIMENSION: "DIMENSION",
  E: "E",
  ERASE: "ERASE",
  Z: "Z",
  REDO: "REDO",
};

const number = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

function point(value: string | undefined): Ponto | null {
  if (!value) return null;
  const clean = value.trim();
  const compact = clean.replace(/^@/, "").replace(/;/g, ",");
  const [x, y, extra] = compact.split(",");
  if (extra !== undefined) return null;
  const px = number(x);
  const py = number(y);
  return px === null || py === null ? null : { x: px, y: -py || 0 };
}

function normalizeAlias(raw: string): CadAlias {
  const key = raw.trim().toUpperCase();
  const alias = ALIAS_MAP[key] ?? (key as CadAlias);
  if (!CAD_ALIASES.includes(alias)) throw new Error(`Comando desconhecido: ${raw || "vazio"}.`);
  return alias;
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

function requireLayer(document: Documento, layerId: string) {
  if (camadaBloqueada(document, layerId)) throw new Error("A camada está bloqueada.");
}

function replaceElement(document: Documento, selected: Elemento): Documento {
  return { ...document, elementos: document.elementos.map((item) => item.id === selected.id ? selected : item) };
}

function runCommand(input: string, context: CadCommandContext): CadCommandResult {
  const tokens = input.trim().split(/\s+/);
  const alias = normalizeAlias(tokens.shift() ?? "");
  const document = context.document;

  if (alias === "E" || alias === "ERASE") return { document, selectedId: null, message: "Seleção cancelada." };
  if (alias === "Z" || alias === "REDO") return { document, selectedId: context.selectedId, message: alias === "Z" ? "Use os controles de zoom da Prancheta." : "Use o botão Refazer." };

  if (alias === "L" || alias === "LINE") {
    requireLayer(document, context.layerId);
    const a = point(tokens[0]);
    const b = point(tokens[1]);
    if (!a || !b) throw new Error("Use: L x1,y1 x2,y2");
    const id = context.createId();
    return { document: { ...document, elementos: [...document.elementos, { id, camada: context.layerId, tipo: "parede", a, b, espessuraMm: 150 }] }, selectedId: id, message: "Linha criada." };
  }

  if (alias === "PL" || alias === "PLINE" || alias === "POLYLINE") {
    requireLayer(document, context.layerId);
    const pontos = tokens.map(point).filter((value): value is Ponto => value !== null);
    if (pontos.length < 2) throw new Error("Use: PL x1,y1 x2,y2 [x3,y3...]");
    const id = context.createId();
    return { document: { ...document, elementos: [...document.elementos, { id, camada: context.layerId, tipo: "traco", pontos, espessuraMm: 25 }] }, selectedId: id, message: "Polilinha criada." };
  }

  if (alias === "C" || alias === "CIRCLE") {
    requireLayer(document, context.layerId);
    const centro = point(tokens[0]);
    const raio = number(tokens[1]);
    if (!centro || raio === null || raio <= 0) throw new Error("Use: C x,y raio");
    const id = context.createId();
    return { document: { ...document, elementos: [...document.elementos, { id, camada: context.layerId, tipo: "arco", centro, raioMm: raio, inicioGraus: 0, varreduraGraus: 360, espessuraMm: 20 }] }, selectedId: id, message: "Círculo criado." };
  }

  const selected = requireSelected(context);
  if (camadaBloqueada(document, selected.camada)) throw new Error("A camada selecionada está bloqueada.");

  if (alias === "M" || alias === "MOVE") {
    const offset = point(tokens[0]);
    if (!offset) throw new Error("Use: M dx,dy");
    const moved = { ...mapPoint(selected, (value) => ({ x: value.x + offset.x, y: value.y + offset.y })), id: selected.id };
    return { document: replaceElement(document, moved), selectedId: selected.id, message: "Elemento movido." };
  }

  if (alias === "CO" || alias === "COPY") {
    const offset = point(tokens[0]);
    if (!offset) throw new Error("Use: CO dx,dy");
    const copy = { ...mapPoint(selected, (value) => ({ x: value.x + offset.x, y: value.y + offset.y })), id: context.createId() };
    return { document: { ...document, elementos: [...document.elementos, copy] }, selectedId: copy.id, message: "Cópia criada." };
  }

  if (alias === "RO" || alias === "ROTATE") {
    const center = point(tokens[0]); const degrees = number(tokens[1]);
    if (!center || degrees === null) throw new Error("Use: RO x,y graus");
    let changed = mapPoint(selected, (value) => rotatePoint(value, center, degrees));
    if ("rotacaoGraus" in changed) changed = { ...changed, rotacaoGraus: normalizeDegrees(changed.rotacaoGraus - degrees) };
    if (changed.tipo === "arco") changed = { ...changed, inicioGraus: normalizeDegrees(changed.inicioGraus + degrees) };
    return { document: replaceElement(document, changed), selectedId: selected.id, message: "Elemento rotacionado." };
  }

  if (alias === "SC" || alias === "SCALE") {
    const center = point(tokens[0]); const factor = number(tokens[1]);
    if (!center || factor === null || factor <= 0) throw new Error("Use: SC x,y fator");
    let changed = mapPoint(selected, (value) => scalePoint(value, center, factor));
    if ("larguraMm" in changed) changed = { ...changed, larguraMm: changed.larguraMm * factor };
    if ("alturaMm" in changed) changed = { ...changed, alturaMm: changed.alturaMm * factor };
    if ("espessuraMm" in changed) changed = { ...changed, espessuraMm: changed.espessuraMm * factor };
    if (changed.tipo === "arco") changed = { ...changed, raioMm: changed.raioMm * factor };
    if (changed.tipo === "cota") changed = { ...changed, deslocamentoMm: changed.deslocamentoMm * factor };
    return { document: replaceElement(document, changed), selectedId: selected.id, message: "Elemento escalado." };
  }

  if (alias === "O" || alias === "OFFSET") {
    const distancia = number(tokens[0]);
    if (distancia === null || distancia === 0) throw new Error("Use: O distância");
    const paralelo = paralelaDe(selected, distancia);
    if (!paralelo) throw new Error("Este elemento não aceita paralela.");
    const copia = { ...paralelo, id: context.createId() };
    return { document: { ...document, elementos: [...document.elementos, copia] }, selectedId: copia.id, message: "Paralela criada." };
  }

  if (alias === "MI" || alias === "MIRROR") {
    const a = point(tokens[0]); const b = point(tokens[1]);
    if (!a || !b) throw new Error("Use: MI x1,y1 x2,y2");
    const espelhado = espelhar(selected, a, b);
    if (!espelhado) throw new Error("O eixo de espelhamento precisa ter comprimento.");
    const copia = { ...espelhado, id: context.createId() };
    return { document: { ...document, elementos: [...document.elementos, copia] }, selectedId: copia.id, message: "Cópia espelhada criada." };
  }

  if (alias === "DIM" || alias === "DIMENSION") {
    requireLayer(document, context.layerId);
    const a = point(tokens[0]); const b = point(tokens[1]);
    const deslocamento = number(tokens[2]) ?? 400;
    if (!a || !b || (a.x === b.x && a.y === b.y)) throw new Error("Use: DIM x1,y1 x2,y2 [deslocamento]");
    const id = context.createId();
    return { document: { ...document, elementos: [...document.elementos, { id, camada: context.layerId, tipo: "cota", a, b, deslocamentoMm: deslocamento }] }, selectedId: id, message: "Cota criada." };
  }

  if (alias === "TR" || alias === "TRIM") {
    const a = point(tokens[0]); const b = point(tokens[1]); const clique = point(tokens[2]) ?? a;
    if (!a || !b || !clique) throw new Error("Use: TR x1,y1 x2,y2 [ponto]");
    const cortante = { a, b, elementoId: "comando-cortante" };
    const ajustado = aparar(selected, cortante, clique);
    if (!ajustado) throw new Error("Nenhum trecho foi cortado.");
    return { document: replaceElement(document, ajustado), selectedId: selected.id, message: "Elemento aparado." };
  }

  if (alias === "EX" || alias === "EXTEND") {
    const a = point(tokens[0]); const b = point(tokens[1]); const clique = point(tokens[2]) ?? a;
    if (!a || !b || !clique) throw new Error("Use: EX x1,y1 x2,y2 [ponto]");
    const cortante = { a, b, elementoId: "comando-cortante" };
    const ajustado = estender(selected, cortante, clique);
    if (!ajustado) throw new Error("O elemento não pode ser estendido até esse limite.");
    return { document: replaceElement(document, ajustado), selectedId: selected.id, message: "Elemento estendido." };
  }

  void segmentosDo(document);
  return { document, selectedId: context.selectedId, message: "Comando concluído." };
}

export function executeCadCommand(input: string, context: CadCommandContext): CadCommandResult {
  const result = runCommand(input, context);
  if (!documentoSchema.safeParse(result.document).success) {
    throw new Error("O comando excede os limites de medidas ou de elementos do desenho.");
  }
  return result;
}
