import ExcelJS from "exceljs";
import { abrirZip } from "@/lib/integrations/planilha-zip";
import { cellKey, evaluateSheet, parseCellKey, type SheetCells } from "@/lib/spreadsheet";
import { conditionalColors, emptyAdvanced } from "@/lib/worksheet-advanced";
import { contentSchema } from "@/lib/worksheets";
import type { z } from "zod";

export type ImportedSheet = { name: string; cells: SheetCells; rows: number; columns: number; warnings: string[] };
const MAX_FILE = 10 * 1024 * 1024;

export async function importXlsx(bytes: Buffer): Promise<ImportedSheet[]> {
  if (bytes.length > MAX_FILE) throw new Error("O arquivo XLSX excede 10 MB.");
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
    sheet.eachRow(row => row.eachCell(cell => {
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
      if (text) { totalCells++; cells[cellKey({ row: Number(cell.row) - 1, column: Number(cell.col) - 1 })] = text; }
      if (totalCells > 20_000) throw new Error("O arquivo excede 20.000 células preenchidas.");
    }));
    return { name: sheet.name, cells, rows: Math.max(1, sheet.rowCount), columns: Math.max(1, sheet.columnCount), warnings: ["Importação de valores: estilos, imagens, gráficos, mesclagens e regras do arquivo não são transferidos.", ...(formulas ? [`${formulas} fórmula(s) serão importadas como resultados salvos, sem recalcular vínculos.`] : [])] };
  });
}

export async function exportXlsx(name: string, content: z.infer<typeof contentSchema>, columns: number) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "H.OIKOS";
  const sheet = workbook.addWorksheet(name.replace(/[\\/*?:[\]]/g, " ").replace(/^'|'$/g, "").trim().slice(0, 31) || "Planilha");
  const computed = evaluateSheet(content.cells), colors = conditionalColors(computed, content.advanced ?? emptyAdvanced);
  for (let column = 1; column <= columns; column++) {
    const key = cellKey({ row: 0, column: column - 1 }).replace(/1$/, "");
    sheet.getColumn(column).width = Math.max(8, (content.widths[key] ?? 120) / 7);
    sheet.getColumn(column).numFmt = ({ moeda: '"R$" #,##0.00', numero: "0.00", percentual: "0.00%" } as Record<string, string>)[content.formats[key]] ?? "General";
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
  const formulas = Object.entries(content.cells).filter(([, raw]) => raw.startsWith("="));
  if (formulas.length) {
    const reference = workbook.addWorksheet(sheet.name === "Fórmulas de referência" ? "Referência das fórmulas" : "Fórmulas de referência");
    reference.addRow(["Célula", "Fórmula original (texto)"]);
    for (const [key, raw] of formulas) reference.addRow([key, raw]);
    reference.getColumn(2).width = 70;
  }
  return workbook.xlsx.writeBuffer();
}

export async function readXlsxBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_FILE) throw new Error("O arquivo XLSX excede 10 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Selecione um arquivo XLSX.");
  const parts: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > MAX_FILE) { await reader.cancel(); throw new Error("O arquivo XLSX excede 10 MB."); } parts.push(part.value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
