// Formatação de texto por célula e mesclagem. Negrito continua em `bold` (lista de chaves),
// que já existia e é usado pelos modelos; o resto mora aqui.
//
// As cores são uma paleta fechada, não hexadecimal livre: o valor salvo é validado no
// servidor e a planilha continua legível impressa e exportada.

import { z } from "zod";

import { cellKey, parseCellKey, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from "@/lib/spreadsheet";

export const textColors = { red: "#b91c1c", green: "#15803d", blue: "#1d4ed8", orange: "#c2410c", gray: "#6b7280" } as const;
export const fillColors = { yellow: "#fef9c3", green: "#dcfce7", blue: "#dbeafe", red: "#fee2e2", orange: "#ffedd5", gray: "#f3f4f6" } as const;
export const colorLabels: Record<string, string> = {
  red: "Vermelho", green: "Verde", blue: "Azul", orange: "Laranja", gray: "Cinza", yellow: "Amarelo",
};

type ColorKey<T> = [keyof T & string, ...(keyof T & string)[]];

export const cellStyleSchema = z.object({
  italic: z.literal(true).optional(),
  underline: z.literal(true).optional(),
  strike: z.literal(true).optional(),
  wrap: z.literal(true).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  color: z.enum(Object.keys(textColors) as ColorKey<typeof textColors>).optional(),
  fill: z.enum(Object.keys(fillColors) as ColorKey<typeof fillColors>).optional(),
}).strict();
export type CellStyle = z.infer<typeof cellStyleSchema>;
export type StyleFlag = "italic" | "underline" | "strike" | "wrap";
export type CellStyles = Record<string, CellStyle>;

export const MAX_MERGES = 200;

export type Bounds = { top: number; left: number; bottom: number; right: number };

/** Limites de um intervalo "A1:C3", normalizado. Nulo se inválido ou fora da grade. */
export function boundsOf(range: string): Bounds | null {
  const [from, to = from] = range.split(":");
  const a = parseCellKey(from ?? ""), b = parseCellKey(to ?? "");
  if (!a || !b) return null;
  const bounds = { top: Math.min(a.row, b.row), left: Math.min(a.column, b.column), bottom: Math.max(a.row, b.row), right: Math.max(a.column, b.column) };
  if (bounds.bottom >= SHEET_MAX_ROWS || bounds.right >= SHEET_MAX_COLUMNS) return null;
  return bounds;
}

export function rangeOf(bounds: Bounds) {
  return `${cellKey({ column: bounds.left, row: bounds.top })}:${cellKey({ column: bounds.right, row: bounds.bottom })}`;
}

const overlaps = (x: Bounds, y: Bounds) => x.left <= y.right && y.left <= x.right && x.top <= y.bottom && y.top <= x.bottom;
const contains = (outer: Bounds, inner: Bounds) => outer.left <= inner.left && outer.right >= inner.right && outer.top <= inner.top && outer.bottom >= inner.bottom;
const single = (bounds: Bounds) => bounds.top === bounds.bottom && bounds.left === bounds.right;

export const mergesSchema = z.array(z.string().regex(/^[A-Z]{1,2}[1-9]\d{0,2}:[A-Z]{1,2}[1-9]\d{0,2}$/)).max(MAX_MERGES)
  .refine((merges) => {
    const all = merges.map(boundsOf);
    if (all.some((bounds) => !bounds || single(bounds))) return false;
    return all.every((bounds, index) => all.every((other, j) => j <= index || !overlaps(bounds!, other!)));
  }, "Mesclagens inválidas: cada uma precisa de duas ou mais células, dentro da grade e sem sobrepor outra.");

/** Mesclagem que contém a célula, com a âncora (canto superior esquerdo). */
export function mergeAt(merges: string[], key: string) {
  const address = parseCellKey(key);
  if (!address) return null;
  for (const range of merges) {
    const bounds = boundsOf(range);
    if (bounds && address.row >= bounds.top && address.row <= bounds.bottom && address.column >= bounds.left && address.column <= bounds.right) {
      return { range, bounds, anchor: cellKey({ column: bounds.left, row: bounds.top }) };
    }
  }
  return null;
}

/** Âncoras com o tamanho do bloco e as células cobertas, para a grade desenhar. */
export function mergeLayout(merges: string[]) {
  const anchors = new Map<string, { rowSpan: number; colSpan: number; bounds: Bounds }>();
  const covered = new Map<string, string>();
  for (const range of merges) {
    const bounds = boundsOf(range);
    if (!bounds) continue;
    const anchor = cellKey({ column: bounds.left, row: bounds.top });
    anchors.set(anchor, { rowSpan: bounds.bottom - bounds.top + 1, colSpan: bounds.right - bounds.left + 1, bounds });
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        const key = cellKey({ column, row });
        if (key !== anchor) covered.set(key, anchor);
      }
    }
  }
  return { anchors, covered };
}

/**
 * Mescla o intervalo. Mesclagens inteiramente dentro dele são absorvidas; uma que o corta
 * pela metade é recusada, porque não há como juntar as duas sem desfazer uma delas.
 */
export function mergeRange(merges: string[], range: string) {
  const bounds = boundsOf(range);
  if (!bounds) throw new Error("Intervalo inválido para mesclar.");
  if (single(bounds)) throw new Error("Selecione duas ou mais células para mesclar.");
  const kept: string[] = [];
  for (const existing of merges) {
    const other = boundsOf(existing);
    if (!other) continue;
    if (contains(bounds, other)) continue;
    if (overlaps(bounds, other)) throw new Error(`O intervalo corta a mesclagem ${existing}. Desfaça-a antes.`);
    kept.push(existing);
  }
  if (kept.length >= MAX_MERGES) throw new Error(`A planilha já tem o limite de ${MAX_MERGES} mesclagens.`);
  return [...kept, rangeOf(bounds)];
}

/** Células que perdem o conteúdo ao mesclar: todas menos a âncora. */
export function cellsHiddenByMerge(cells: Record<string, string>, range: string) {
  const bounds = boundsOf(range);
  if (!bounds) return [];
  const anchor = cellKey({ column: bounds.left, row: bounds.top });
  return Object.keys(cells).filter((key) => {
    const address = parseCellKey(key);
    return key !== anchor && !!address && cells[key] !== "" && address.row >= bounds.top && address.row <= bounds.bottom
      && address.column >= bounds.left && address.column <= bounds.right;
  });
}

export function unmergeAt(merges: string[], key: string) {
  const found = mergeAt(merges, key);
  return found ? merges.filter((range) => range !== found.range) : merges;
}

/** Liga ou desliga uma marca em todas as células: se todas já têm, tira; senão, põe. */
export function toggleFlag(styles: CellStyles, keys: string[], flag: StyleFlag): CellStyles {
  const remove = keys.length > 0 && keys.every((key) => styles[key]?.[flag]);
  return updateStyles(styles, keys, (style) => ({ ...style, [flag]: remove ? undefined : true }));
}

export function setStyle<K extends "align" | "color" | "fill">(styles: CellStyles, keys: string[], field: K, value: CellStyle[K] | undefined): CellStyles {
  return updateStyles(styles, keys, (style) => ({ ...style, [field]: value }));
}

export function clearStyles(styles: CellStyles, keys: string[]): CellStyles {
  const next = { ...styles };
  for (const key of keys) delete next[key];
  return next;
}

function updateStyles(styles: CellStyles, keys: string[], change: (style: CellStyle) => CellStyle): CellStyles {
  const next = { ...styles };
  for (const key of new Set(keys)) {
    const style = Object.fromEntries(Object.entries(change(next[key] ?? {})).filter(([, value]) => value !== undefined)) as CellStyle;
    if (Object.keys(style).length) next[key] = style; else delete next[key];
  }
  if (Object.keys(next).length > 20_000) throw new Error("Selecione menos células para formatar.");
  return next;
}

/**
 * Desloca valores guardados por chave de célula quando entra ou sai linha/coluna — o mesmo
 * movimento que as células fazem. Sem isso, o itálico da linha 5 ficaria na linha 5 depois
 * de inserir uma linha acima, formatando o item vizinho.
 */
export function shiftKeyed<T>(record: Record<string, T>, axis: "row" | "column", at: number, delta: number): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const address = parseCellKey(key);
    if (!address) continue;
    const position = address[axis];
    if (delta < 0 && position === at) continue;
    const moved = position < at ? position : position + delta;
    if (moved < 0 || moved >= (axis === "row" ? SHEET_MAX_ROWS : SHEET_MAX_COLUMNS)) continue;
    next[cellKey({ ...address, [axis]: moved })] = value;
  }
  return next;
}

/** Inserir dentro de uma mesclagem a estica; remover a encolhe; se sobrar uma célula, ela some. */
export function shiftMerges(merges: string[], axis: "row" | "column", at: number, delta: number): string[] {
  const [start, end] = axis === "row" ? ["top", "bottom"] as const : ["left", "right"] as const;
  const limit = axis === "row" ? SHEET_MAX_ROWS : SHEET_MAX_COLUMNS;
  return merges.flatMap((range) => {
    const bounds = boundsOf(range);
    if (!bounds) return [];
    const next = { ...bounds };
    if (delta > 0) {
      if (at <= bounds[start]) { next[start] += delta; next[end] += delta; }
      else if (at <= bounds[end]) next[end] += delta;
    } else {
      if (at < bounds[start]) { next[start] += delta; next[end] += delta; }
      else if (at <= bounds[end]) next[end] += delta;
    }
    if (next[start] >= limit || next[end] < next[start]) return [];
    next[end] = Math.min(next[end], limit - 1);
    return single(next) ? [] : [rangeOf(next)];
  });
}

/** Reposiciona por linha, seguindo a ordenação: a formatação anda junto com o dado. */
export function remapRows<T>(record: Record<string, T>, destination: Record<number, number>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const address = parseCellKey(key);
    if (!address) continue;
    next[cellKey({ ...address, row: destination[address.row] ?? address.row })] = value;
  }
  return next;
}

/** Mesclagem que ocupa mais de uma linha dentro da faixa impede ordenar a faixa. */
export function mergeSpansRows(merges: string[], fromRow: number, toRowExclusive: number) {
  return merges.some((range) => {
    const bounds = boundsOf(range);
    return !!bounds && bounds.bottom > bounds.top && bounds.bottom >= fromRow && bounds.top < toRowExclusive;
  });
}

/** CSS da célula a partir do estilo. `fill` perde para a cor condicional, que é regra de dado. */
export function styleCss(style: CellStyle | undefined) {
  if (!style) return {};
  const decoration = [style.underline ? "underline" : "", style.strike ? "line-through" : ""].filter(Boolean).join(" ");
  return {
    ...(style.italic ? { fontStyle: "italic" as const } : {}),
    ...(decoration ? { textDecorationLine: decoration } : {}),
    ...(style.color ? { color: textColors[style.color] } : {}),
    ...(style.align ? { textAlign: style.align } : {}),
    ...(style.wrap ? { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const } : {}),
  };
}
