import { z } from "zod";

import { SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from "@/lib/spreadsheet";

export const worksheetKinds = ["sheet", "document", "analysis"] as const;

export const cellsSchema = z.record(
  z.string().regex(/^[A-Z]{1,2}[1-9]\d{0,3}$/),
  z.string().max(2000),
).refine((cells) => Object.keys(cells).length <= 20_000, { message: "A planilha excedeu o limite de células." });

const columnLetter = z.string().regex(/^[A-Z]{1,2}$/);

export const analysisSettingsSchema = z.object({
  headerRow: z.number().int().min(0).max(50).default(0),
  roles: z.record(columnLetter, z.enum([
    "ignorar", "descricao", "setor", "data", "receita", "custo",
    "custo_colaborador", "horas", "quantidade", "preco_unitario",
  ])).default({}),
  targetMarginPercent: z.number().min(0).max(95).default(20),
  ignoreRows: z.array(z.number().int().min(0).max(499)).max(50).default([]),
}).strict();

export const contentSchema = z.object({
  cells: cellsSchema.default({}),
  body: z.string().max(400_000).default(""),
  widths: z.record(z.string(), z.number().int().min(60).max(600)).default({}),
  formats: z.record(columnLetter, z.enum(["texto", "numero", "moeda", "percentual"])).default({}),
  bold: z.array(z.string().regex(/^[A-Z]{1,2}[1-9]\d{0,3}$/)).max(5000).default([]),
  recipes: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    actions: z.array(z.enum(["trim", "upper", "lower", "number", "values", "clear"])).min(1).max(12),
  }).strict()).max(20).default([]),
  analysis: analysisSettingsSchema.default({ headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [] }),
}).strict();

export const worksheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(worksheetKinds).default("sheet"),
  // O modelo é montado no servidor: o navegador escolhe qual, nunca o conteúdo dele.
  templateId: z.string().trim().max(60).optional(),
  columns: z.number().int().min(1).max(SHEET_MAX_COLUMNS).default(12),
  rows: z.number().int().min(1).max(SHEET_MAX_ROWS).default(60),
  content: contentSchema.default({ cells: {}, body: "", widths: {} }),
});

export type WorksheetRow = {
  id: string; organization_id: string; kind: string; name: string; content_json: string;
  columns: number; rows: number; created_by_member_id: string | null; created_by_name: string;
  visibility: string; revision: number; created_at: number; updated_at: number;
};

export type WorksheetAccess = { canView: boolean; canEdit: boolean; canGovern: boolean; canDelete: boolean; level: string };

// Regra única de acesso, para nenhuma rota divergir da outra.
// A planilha de saúde financeira é governada pelo superadministrador: só ele cria,
// exclui e libera acesso. Quem recebe liberação vê, e edita se a liberação disser.
export function worksheetAccess(
  row: Pick<WorksheetRow, "visibility" | "created_by_member_id">,
  viewer: { memberId: string; role: string; isSuperAdmin: boolean },
  grant: { level: string } | null,
): WorksheetAccess {
  if (viewer.isSuperAdmin) return { canView: true, canEdit: true, canGovern: true, canDelete: true, level: "superadmin" };
  if (row.visibility !== "restricted") {
    const canDelete = row.created_by_member_id === viewer.memberId || ["owner", "admin"].includes(viewer.role);
    return { canView: true, canEdit: true, canGovern: false, canDelete, level: "empresa" };
  }
  if (grant?.level === "edit") return { canView: true, canEdit: true, canGovern: false, canDelete: false, level: "edit" };
  if (grant?.level === "view") return { canView: true, canEdit: false, canGovern: false, canDelete: false, level: "view" };
  return { canView: false, canEdit: false, canGovern: false, canDelete: false, level: "nenhum" };
}

export function worksheetResponse(row: WorksheetRow) {
  let content = {
    cells: {}, body: "", widths: {}, formats: {}, bold: [],
    analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [] },
  };
  try { content = { ...content, ...JSON.parse(row.content_json) }; } catch { /* conteúdo inválido volta vazio */ }
  return {
    id: row.id, kind: row.kind, name: row.name, columns: row.columns, rows: row.rows,
    createdByMemberId: row.created_by_member_id, createdByName: row.created_by_name,
    visibility: row.visibility, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at, content,
  };
}
