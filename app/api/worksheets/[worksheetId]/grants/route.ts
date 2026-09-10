import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  ensureFound,
  isPlatformSuperAdmin,
  jsonBody,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";
import { type WorksheetRow } from "@/lib/worksheets";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ worksheetId: string }> };

// Quem garante que a pessoa existe é a checagem contra `members`, logo abaixo. Exigir
// formato de UUID aqui só recusaria um id legado sem ganhar nenhuma segurança.
const grantSchema = z.object({
  memberId: z.string().trim().min(1).max(64),
  level: z.enum(["view", "edit", "none"]),
}).strict();

// Quem libera é o superadministrador, e só ele. A liberação é por pessoa e diz se o
// acesso é de leitura ou de leitura e edição.
async function governedWorksheet(request: Request, route: RouteContext) {
  const context = await requireOrganizationContext(request);
  if (!isPlatformSuperAdmin(context)) {
    throw new ApiError(403, "analysis_superadmin_only", "Somente o superadministrador libera acesso a esta planilha.");
  }
  const { worksheetId } = await route.params;
  if (!z.string().uuid().safeParse(worksheetId).success) throw new ApiError(404, "not_found", "Planilha não encontrada.");
  const worksheet = ensureFound(await context.db.prepare("SELECT * FROM worksheets WHERE id = ?1 AND organization_id = ?2")
    .bind(worksheetId, context.organization.id).first<WorksheetRow>(), "Planilha");
  return { context, worksheet };
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { context, worksheet } = await governedWorksheet(request, route);
    const members = await context.db.prepare(
      `SELECT m.id, m.name, m.email, m.role, g.level
       FROM members m LEFT JOIN worksheet_grants g ON g.worksheet_id = ?2 AND g.member_id = m.id
       WHERE m.organization_id = ?1 AND m.active = 1 AND m.role != 'superadmin'
       ORDER BY m.name`,
    ).bind(context.organization.id, worksheet.id).all<{ id: string; name: string; email: string; role: string; level: string | null }>();
    return Response.json({
      worksheet: { id: worksheet.id, name: worksheet.name, visibility: worksheet.visibility },
      members: members.results.map((member) => ({ ...member, level: member.level ?? "none" })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { context, worksheet } = await governedWorksheet(request, route);
    const parsed = grantSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const { memberId, level } = parsed.data;

    const member = ensureFound(await context.db.prepare(
      "SELECT id, name FROM members WHERE id = ?1 AND organization_id = ?2 AND active = 1 AND role != 'superadmin'",
    ).bind(memberId, context.organization.id).first<{ id: string; name: string }>(), "Pessoa");

    await context.db.batch([
      level === "none"
        ? context.db.prepare("DELETE FROM worksheet_grants WHERE worksheet_id = ?1 AND member_id = ?2").bind(worksheet.id, member.id)
        : context.db.prepare(
          `INSERT INTO worksheet_grants (worksheet_id, organization_id, member_id, level, granted_by_email, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(worksheet_id, member_id) DO UPDATE SET level = excluded.level,
             granted_by_email = excluded.granted_by_email, created_at = excluded.created_at`,
        ).bind(worksheet.id, context.organization.id, member.id, level, context.user.email, Date.now()),
      auditStatement(context, level === "none" ? "worksheet.access_revoked" : "worksheet.access_granted",
        "worksheet", worksheet.id, { memberId: member.id, memberName: member.name, level }),
    ]);
    return Response.json({ saved: true, memberId: member.id, level });
  });
}
