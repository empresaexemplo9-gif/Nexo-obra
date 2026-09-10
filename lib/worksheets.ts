import { z } from "zod";

import { SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from "@/lib/spreadsheet";

export const worksheetKinds = ["sheet", "document"] as const;

export const cellsSchema = z.record(
  z.string().regex(/^[A-Z]{1,2}[1-9]\d{0,3}$/),
  z.string().max(2000),
).refine((cells) => Object.keys(cells).length <= 20_000, { message: "A planilha excedeu o limite de células." });

export const contentSchema = z.object({
  cells: cellsSchema.default({}),
  body: z.string().max(400_000).default(""),
  widths: z.record(z.string(), z.number().int().min(60).max(600)).default({}),
}).strict();

export const worksheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(worksheetKinds).default("sheet"),
  columns: z.number().int().min(1).max(SHEET_MAX_COLUMNS).default(12),
  rows: z.number().int().min(1).max(SHEET_MAX_ROWS).default(60),
  content: contentSchema.default({ cells: {}, body: "", widths: {} }),
});

export type WorksheetRow = {
  id: string; organization_id: string; kind: string; name: string; content_json: string;
  columns: number; rows: number; created_by_member_id: string | null; created_by_name: string;
  revision: number; created_at: number; updated_at: number;
};

export function worksheetResponse(row: WorksheetRow) {
  let content = { cells: {}, body: "", widths: {} };
  try { content = { ...content, ...JSON.parse(row.content_json) }; } catch { /* conteúdo inválido volta vazio */ }
  return {
    id: row.id, kind: row.kind, name: row.name, columns: row.columns, rows: row.rows,
    createdByMemberId: row.created_by_member_id, createdByName: row.created_by_name,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, content,
  };
}
