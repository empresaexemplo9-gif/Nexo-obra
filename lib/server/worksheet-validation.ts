import { ApiError } from "@/lib/server/backend";
import { evaluateSheet, type SheetCells } from "@/lib/spreadsheet";
import { validationIssues, type AdvancedSettings } from "@/lib/worksheet-advanced";

export function enforceWorksheetValidation(content: { cells: SheetCells; advanced?: AdvancedSettings }) {
  if (!content.advanced?.validations.length) return;
  const issues = validationIssues(evaluateSheet(content.cells), content.advanced);
  if (issues.size) throw new ApiError(422, "worksheet_validation", `Corrija ${issues.size} célula(s) inválida(s): ${[...issues.keys()].slice(0, 10).join(", ")}.`);
}
