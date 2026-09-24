import ExcelJS from "exceljs";
import { abrirZip } from "@/lib/integrations/planilha-zip";
import { cellKey, evaluateSheet, parseCellKey, type SheetCells } from "@/lib/spreadsheet";
import { conditionalColors, emptyAdvanced } from "@/lib/worksheet-advanced";
import { boundsOf, fillColors, MAX_MERGES, rangeOf, textColors, type CellStyle, type CellStyles } from "@/lib/worksheet-format";
import { contentSchema } from "@/lib/worksheets";
import type { z } from "zod";

export type ImportedSheet = {
  name: string; cells: SheetCells; rows: number; columns: number; warnings: string[];
  bold: string[]; styles: CellStyles; merges: string[]; notes: Record<string, string>; hiddenRows: number[]; hiddenColumns: number[];
};
const MAX_FILE = 4 * 1024 * 1024;

export async function importXlsx(bytes: Buffer): Promise<ImportedSheet[]> {
  if (bytes.length > MAX_FILE) throw new Error("O arquivo XLSX excede 4 MB.");
  const zip = abrirZip(bytes, 8 * 1024 * 1024);
  if (zip.entradas.length > 1000) throw new Error("O arquivo contém entradas demais.");
  let total = 0;
  for (const entry of zip.entradas) {
    total += entry.tamanho;
    if (total > 32 * 1024 * 1024) throw new Error("O XLSX descomprimido excede 32 MB.");
    if (/vbaProject|externalLinks/i.test(entry.nome)) throw new Error("Remova macros e vínculos externos antes de importar.");
    zip.extrair(entry.nome); // Valida tamanho real e CRC antes de o parser carregar o arquivo.
  }
  if (!zip.entradas.some(entry => entry.nome === "xl/workbook.xml")) throw new Error("Arquivo XLSX inválido.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  if (workbook.worksheets.length > 20) throw new Error("Importe arquivos com até 20 abas.");
  let totalCells = 0;
  return workbook.worksheets.map(sheet => {
    if (sheet.rowCount > 500 || sheet.columnCount > 52) throw new Error(`A aba ${sheet.name} excede 500 linhas ou 52 colunas. Reduza o arquivo antes de importar.`);
    const cells: SheetCells = {}; let formulas = 0;
    const bold: string[] = []; const styles: CellStyles = {}; const notes: Record<string, string> = {};
    // Mesclagens do arquivo, dentro da grade e sem sobrepor. As que não cabem viram aviso.
    const merges: string[] = []; let ignoredMerges = 0;
    for (const range of (sheet.model as { merges?: string[] }).merges ?? []) {
      const bounds = boundsOf(range.replaceAll("$", ""));
      if (!bounds || merges.length >= MAX_MERGES) { ignoredMerges++; continue; }
      merges.push(rangeOf(bounds));
    }
    sheet.eachRow(row => row.eachCell(cell => {
      // Célula coberta por mesclagem repete o valor da âncora no ExcelJS; importar faria
      // o texto aparecer várias vezes.
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const key = cellKey({ row: Number(cell.row) - 1, column: Number(cell.col) - 1 });
      const style: CellStyle = {};
      if (cell.font?.italic) style.italic = true;
      if (cell.font?.underline) style.underline = true;
      if (cell.font?.strike) style.strike = true;
      if (cell.alignment?.wrapText) style.wrap = true;
      const horizontal = cell.alignment?.horizontal;
      if (horizontal === "left" || horizontal === "right") style.align = horizontal;
      if (horizontal === "center" || horizontal === "centerContinuous") style.align = "center";
      if (Object.keys(style).length) styles[key] = style;
      if (cell.font?.bold) bold.push(key);
      const note = typeof cell.note === "string" ? cell.note
        : cell.note && typeof cell.note === "object" && "texts" in cell.note ? (cell.note.texts ?? []).map((part) => part.text).join("") : "";
      if (note.trim()) notes[key] = note.trim().slice(0, 1000);
      let value = cell.value;
      if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
        formulas++;
        if (value.result === undefined || value.result === null) throw new Error(`${sheet.name}!${cell.address}: fórmula sem resultado salvo. Recalcule e salve o arquivo no Excel ou Google Planilhas.`);
        value = value.result;
      }
      if (value && typeof value === "object" && "error" in value) throw new Error(`${sheet.name}!${cell.address}: corrija o erro ${value.error} antes de importar.`);
      let text = value instanceof Date ? value.toISOString().slice(0, 10)
        : typeof value === "number" ? String(value).replace(".", ",")
        : value && typeof value === "object" && "richText" in value ? value.richText.map(part => part.text).join("")
        : value && typeof value === "object" && "text" in value ? value.text
        : value === null ? "" : String(value);
      // Preserve strings that the local engine would otherwise interpret as numbers,
      // booleans, formulas or an apostrophe escape (e.g. an account code 00123).
      if (typeof value !== "number" && typeof value !== "boolean" && !(value instanceof Date)) {
        const interpreted = evaluateSheet({ A1: text }).A1;
        if (text.startsWith("=") || text.startsWith("'") || interpreted?.value !== text) text = "'" + text;
      }
      if (text.length > 2000) throw new Error(`${cell.address}: limite de 2.000 caracteres por célula.`);
      if (text) { totalCells++; cells[key] = text; }
      if (totalCells > 20_000) throw new Error("O arquivo excede 20.000 células preenchidas.");
    }));
    return {
      name: sheet.name, cells, bold: bold.slice(0, 5000), styles, merges, notes,
      hiddenRows: Array.from({ length: Math.min(sheet.rowCount, 500) }, (_, i) => i).filter((i) => sheet.getRow(i + 1).hidden),
      hiddenColumns: Array.from({ length: Math.min(sheet.columnCount, 52) }, (_, i) => i).filter((i) => sheet.getColumn(i + 1).hidden),
      rows: Math.max(1, sheet.rowCount), columns: Math.max(1, sheet.columnCount),
      warnings: [
        "Vêm do arquivo: valores, negrito, itálico, sublinhado, tachado, alinhamento, quebra de texto, mesclagens, notas e linhas/colunas ocultas. Cores, bordas, imagens, gráficos e regras não são transferidos.",
        ...(formulas ? [`${formulas} fórmula(s) serão importadas como resultados salvos, sem recalcular vínculos.`] : []),
        ...(ignoredMerges ? [`${ignoredMerges} mesclagem(ns) fora da grade ou além do limite de ${MAX_MERGES} foram ignoradas.`] : []),
      ],
    };
  });
}

export async function exportXlsx(name: string, content: z.infer<typeof contentSchema>, columns: number) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "H.OIKOS";
  const sheet = workbook.addWorksheet(name.replace(/[\\/*?:[\]\u0000-\u001f]/g, " ").trim().slice(0, 31).replace(/^'+|'+$/g, "") || "Planilha");
  const computed = evaluateSheet(content.cells), colors = conditionalColors(computed, content.advanced ?? emptyAdvanced);
  if (content.frozenColumns > 0) sheet.views = [{ state: "frozen", xSplit: content.frozenColumns, ySplit: 0 }];
  for (let column = 1; column <= columns; column++) {
    const key = cellKey({ row: 0, column: column - 1 }).replace(/1$/, "");
    sheet.getColumn(column).width = Math.max(8, (content.widths[key] ?? 120) / 7);
    sheet.getColumn(column).numFmt = ({ moeda: '"R$" #,##0.00', contabil: '"R$" #,##0.00;[Red]("R$" #,##0.00)', numero: "0.00", percentual: "0.00%" } as Record<string, string>)[content.formats[key]] ?? "General";
  }
  const bold = new Set(content.bold);
  for (const [key, result] of Object.entries(computed)) {
    const address = parseCellKey(key);
    if (!address || address.row >= 500 || address.column >= 52) throw new Error("Célula fora do limite da planilha.");
    if (result.error) throw new Error(`Corrija o erro em ${key} antes de exportar: ${result.error}.`);
    const cell = sheet.getCell(key); cell.value = result.value;
    if (bold.has(key)) cell.font = { bold: true };
    if (colors[key]) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + colors[key].slice(1).toUpperCase() } };
  }
  // Estilos por célula (inclusive em célula vazia com fundo) e mesclagens.
  for (const [key, style] of Object.entries(content.styles)) {
    const cell = sheet.getCell(key);
    cell.font = {
      ...cell.font,
      ...(style.italic ? { italic: true } : {}), ...(style.underline ? { underline: true } : {}), ...(style.strike ? { strike: true } : {}),
      ...(style.color ? { color: { argb: "FF" + textColors[style.color].slice(1).toUpperCase() } } : {}),
    };
    if (style.align || style.wrap) cell.alignment = { ...(style.align ? { horizontal: style.align } : {}), ...(style.wrap ? { wrapText: true, vertical: "top" as const } : {}) };
    if (style.fill && !colors[key]) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + fillColors[style.fill].slice(1).toUpperCase() } };
  }
  for (const range of content.merges) sheet.mergeCells(range);
  for (const [key, note] of Object.entries(content.notes)) sheet.getCell(key).note = note;
  for (const row of content.hiddenRows) sheet.getRow(row + 1).hidden = true;
  for (const column of content.hiddenColumns) sheet.getColumn(column + 1).hidden = true;
  const formulas = Object.entries(content.cells).filter(([, raw]) => raw.startsWith("="));
  if (formulas.length) {
    const reference = workbook.addWorksheet(sheet.name.toLocaleLowerCase("pt-BR") === "fórmulas de referência" ? "Referência das fórmulas" : "Fórmulas de referência");
    reference.addRow(["Célula", "Fórmula original (texto)"]);
    for (const [key, raw] of formulas) reference.addRow([key, raw]);
    reference.getColumn(2).width = 70;
  }
  return workbook.xlsx.writeBuffer();
}

export async function readXlsxBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_FILE) throw new Error("O arquivo XLSX excede 4 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Selecione um arquivo XLSX.");
  const parts: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > MAX_FILE) { await reader.cancel(); throw new Error("O arquivo XLSX excede 4 MB."); } parts.push(part.value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
