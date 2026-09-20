import { cellKey, displayValue, evaluateSheet, parseCellKey, parseNumber, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, type CellResult, type SheetCells } from "./spreadsheet";

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
