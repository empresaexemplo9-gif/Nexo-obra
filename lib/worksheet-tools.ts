import { fillColors, mergeLayout, styleCss, type CellStyles } from "./worksheet-format";
import { cellKey, columnName, displayValue, evaluateSheet, parseCellKey, parseNumber, SHEET_FUNCTIONS, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, type CellResult, type SheetCells, type SheetResult } from "./spreadsheet";

export const bulkActions = {
  trim: "Remover espaços extras", upper: "Converter para maiúsculas", lower: "Converter para minúsculas",
  number: "Converter textos numéricos", values: "Substituir fórmulas pelos resultados", clear: "Limpar conteúdo",
} as const;
export type BulkAction = keyof typeof bulkActions;

// Every step receives the previous step's result; formulas are preserved except
// when the user explicitly selects conversion to values or clearing.
export function runActions(cells: SheetCells, keys: string[], actions: BulkAction[]): SheetCells {
  const next = { ...cells };
  for (const action of actions) {
    const computed = action === "values" ? evaluateSheet(next) : {};
    for (const key of new Set(keys)) {
      const raw = next[key];
      if (raw === undefined) continue;
      if (action === "clear") { delete next[key]; continue; }
      if (action === "values" && raw.startsWith("=")) {
        const result = computed[key];
        if (result?.error) throw new Error(`A célula ${key} contém ${result.error}. Corrija a fórmula antes de converter.`);
        next[key] = typeof result?.value === "number" ? String(result.value).replace(".", ",")
          : typeof result?.value === "string" ? `'${result.value}` : displayValue(result?.value ?? null);
        continue;
      }
      if (raw.startsWith("=")) continue;
      if (action === "trim") next[key] = raw.trim().replace(/\s+/g, " ");
      if (action === "upper") next[key] = raw.toLocaleUpperCase("pt-BR");
      if (action === "lower") next[key] = raw.toLocaleLowerCase("pt-BR");
      if (action === "number") {
        const numeric = parseNumber(raw);
        if (numeric !== null) next[key] = String(numeric).replace(".", ",");
      }
    }
  }
  return next;
}

export function replaceInSelection(cells: SheetCells, keys: string[], find: string, replacement: string) {
  if (!find) throw new Error("Digite o texto a localizar.");
  const next = { ...cells };
  for (const key of keys) if (next[key] && !next[key].startsWith("=")) next[key] = next[key].replaceAll(find, replacement);
  return next;
}

export function parseTable(text: string, delimiter: string): string[][] {
  if (![";", ",", "\t"].includes(delimiter)) throw new Error("Separador inválido.");
  if (text.length > 2_000_000) throw new Error("O arquivo excede 2 MB.");
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  const finishCell = () => {
    if (value.length > 2000) throw new Error("Uma célula excede 2.000 caracteres.");
    row.push(value); value = "";
    if (row.length > SHEET_MAX_COLUMNS) throw new Error(`A tabela excede ${SHEET_MAX_COLUMNS} colunas.`);
  };
  const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > SHEET_MAX_ROWS) throw new Error(`A tabela excede ${SHEET_MAX_ROWS} linhas.`); };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || !value) quoted = !quoted;
      else value += c;
    } else if (!quoted && c === delimiter) finishCell();
    else if (!quoted && c === "\n") finishRow();
    else value += c;
  }
  if (quoted) throw new Error("O CSV contém aspas não fechadas.");
  if (value || row.length || !rows.length) finishRow();
  return rows;
}

export function placeTable(cells: SheetCells, start: string, table: string[][]) {
  const origin = parseCellKey(start);
  if (!origin || !table.length) throw new Error("Selecione uma célula válida.");
  const columns = origin.column + Math.max(...table.map(row => row.length));
  const rows = origin.row + table.length;
  if (columns > SHEET_MAX_COLUMNS || rows > SHEET_MAX_ROWS) throw new Error(`A tabela não cabe a partir de ${start}. Limite: ${SHEET_MAX_ROWS} linhas e ${SHEET_MAX_COLUMNS} colunas.`);
  const next = { ...cells };
  table.forEach((row, y) => row.forEach((value, x) => {
    if (value.length > 2000) throw new Error("Uma célula excede 2.000 caracteres.");
    const key = cellKey({ column: origin.column + x, row: origin.row + y });
    if (value) next[key] = value; else delete next[key];
  }));
  if (Object.keys(next).length > 20_000) throw new Error("A planilha excede 20.000 células preenchidas.");
  return { cells: next, columns, rows };
}

export function formattedCell(result: CellResult | undefined, format: string | undefined) {
  if (!result || result.error || typeof result.value !== "number") return result?.display ?? "";
  if (format === "moeda") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(result.value);
  // Contábil: negativo entre parênteses (e em vermelho na grade), como no Excel.
  if (format === "contabil") {
    const texto = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Math.abs(result.value));
    return result.value < 0 ? `(${texto})` : texto;
  }
  if (format === "percentual") return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 }).format(result.value);
  if (format === "numero") return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(result.value);
  return result.display;
}

export function selectionToTsv(cells: SheetCells, keys: string[]) {
  const addresses = keys.map(parseCellKey).filter((address): address is NonNullable<typeof address> => !!address);
  if (!addresses.length) return "";
  const chosen = new Set(keys); const computed = evaluateSheet(cells);
  const minRow = Math.min(...addresses.map(a => a.row)), maxRow = Math.max(...addresses.map(a => a.row));
  const minCol = Math.min(...addresses.map(a => a.column)), maxCol = Math.max(...addresses.map(a => a.column));
  return Array.from({ length: maxRow - minRow + 1 }, (_, y) => Array.from({ length: maxCol - minCol + 1 }, (_, x) => {
    const key = cellKey({ row: y + minRow, column: x + minCol });
    const value = chosen.has(key) ? (computed[key]?.error ?? computed[key]?.value) : null;
    const text = typeof value === "number" ? String(value).replace(".", ",") : displayValue(value ?? null);
    return /[\t\n\r"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join("\t")).join("\n");
}

/** O formato contábil pinta o negativo de vermelho. Os outros formatos não: nem todo
 *  negativo é prejuízo (desvio abaixo do previsto é economia). */
export function negativoEmDestaque(result: CellResult | undefined, format: string | undefined) {
  return format === "contabil" && !!result && !result.error && typeof result.value === "number" && result.value < 0;
}

const semAcento = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/**
 * Funções que completam o nome que está sendo digitado no fim da fórmula. "=SO" sugere
 * SOMA e SOMASE; "=A1+ME" sugere MEDIA e MEDIANA. Fora de fórmula, ou dentro de texto
 * entre aspas, não sugere nada.
 */
export function sugestoesDeFuncao(raw: string, limite = 6): { parcial: string; funcoes: string[] } {
  if (!raw.startsWith("=")) return { parcial: "", funcoes: [] };
  if ((raw.match(/"/g)?.length ?? 0) % 2 === 1) return { parcial: "", funcoes: [] };
  const match = /(?:^=|[=(;+\-*/^&<>\s])([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.]*)$/.exec(raw);
  if (!match) return { parcial: "", funcoes: [] };
  const parcial = match[1];
  // "=A" pode ser o começo de A1: a sugestão aparece, mas some ao digitar o número.
  const alvo = semAcento(parcial);
  const funcoes = SHEET_FUNCTIONS.filter((name) => name.startsWith(alvo) && name !== alvo).slice(0, limite);
  return { parcial, funcoes: [...funcoes] };
}

/** Completa a fórmula com a função escolhida, já abrindo o parêntese. */
export function aplicarSugestao(raw: string, parcial: string, funcao: string) {
  return `${raw.slice(0, raw.length - parcial.length)}${funcao}(`;
}

/**
 * Tabela pronta para imprimir: os valores já calculados e formatados, recortada até a
 * última linha e a última coluna preenchidas. Imprimir 500 linhas vazias desperdiça papel.
 */
export function tabelaParaImpressao(
  computed: SheetResult, formats: Record<string, string>, bold: string[], columns: number, rows: number,
  styles: CellStyles = {}, merges: string[] = [],
) {
  let ultimaLinha = -1, ultimaColuna = -1;
  const layout = mergeLayout(merges);
  const alcancar = (row: number, column: number) => {
    if (row >= rows || column >= columns) return;
    ultimaLinha = Math.max(ultimaLinha, row);
    ultimaColuna = Math.max(ultimaColuna, column);
  };
  for (const [key, result] of Object.entries(computed)) {
    const address = parseCellKey(key);
    if (!address || result.display === "") continue;
    alcancar(address.row, address.column);
    // Um título mesclado sobre A1:F1 precisa levar as seis colunas para o papel.
    const bloco = layout.anchors.get(key)?.bounds;
    if (bloco) alcancar(bloco.bottom, bloco.right);
  }
  const negrito = new Set(bold);
  const letras = Array.from({ length: ultimaColuna + 1 }, (_, column) => columnName(column));
  const linhas = Array.from({ length: ultimaLinha + 1 }, (_, row) => letras.map((letra, column) => {
    const key = cellKey({ column, row });
    const result = computed[key];
    const bloco = layout.anchors.get(key);
    const estilo = styles[key];
    return {
      texto: formattedCell(result, formats[letra]),
      numero: typeof result?.value === "number" && !result.error,
      negrito: negrito.has(key),
      negativo: negativoEmDestaque(result, formats[letra]),
      coberta: layout.covered.has(key),
      colSpan: bloco ? Math.min(bloco.colSpan, ultimaColuna - column + 1) : 1,
      rowSpan: bloco ? Math.min(bloco.rowSpan, ultimaLinha - row + 1) : 1,
      css: { ...styleCss(estilo), ...(estilo?.fill ? { backgroundColor: fillColors[estilo.fill] } : {}) },
    };
  }));
  return { letras, linhas };
}
