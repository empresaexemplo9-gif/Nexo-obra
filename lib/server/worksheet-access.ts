import { z } from "zod";
import { ApiError, ensureFound, isPlatformSuperAdmin, requireOrganizationContext } from "@/lib/server/backend";
import { worksheetAccess, type WorksheetRow } from "@/lib/worksheets";

export async function loadWorksheet(context: Awaited<ReturnType<typeof requireOrganizationContext>>, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, "not_found", "Planilha não encontrada.");
  const row = ensureFound(await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
    .bind(id, context.organization.id).first<WorksheetRow>(), "Planilha");
  const grant = await context.db.prepare("SELECT level FROM worksheet_grants WHERE worksheet_id = ?1 AND member_id = ?2")
    .bind(row.id, context.member.id).first<{ level: string }>();
  const access = worksheetAccess(row, { memberId: context.member.id, role: context.member.role, isSuperAdmin: isPlatformSuperAdmin(context) }, grant);
  if (!access.canView) throw new ApiError(404, "not_found", "Planilha não encontrada.");
  return { row, access };
}
