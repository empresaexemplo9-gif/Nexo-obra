import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const linkSchema = z.object({
  projectId: z.string().uuid(),
  externalCostCenterId: z.string().trim().min(1).max(160),
  externalCustomerId: z.string().trim().min(1).max(160).nullable().optional(),
});

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "edit");
    const parsed = linkSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const project = await context.db.prepare("SELECT id, client_id FROM projects WHERE id = ?1 AND organization_id = ?2").bind(parsed.data.projectId, context.organization.id).first<{ id: string; client_id: string | null }>();
    if (!project) throw new ApiError(404, "not_found", "Projeto ou obra não encontrado.");
    if (parsed.data.externalCustomerId && !project.client_id) throw new ApiError(409, "project_client_required", "Vincule um cliente ao projeto antes do cadastro financeiro.");
    const statements = [
      context.db.prepare("UPDATE projects SET external_financial_cost_center_id = ?1, drap_cost_center_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND organization_id = ?3").bind(parsed.data.externalCostCenterId, parsed.data.projectId, context.organization.id),
      auditStatement(context, "project.drap_cost_center_linked", "project", parsed.data.projectId),
    ];
    if (parsed.data.externalCustomerId && project.client_id) {
      statements.push(context.db.prepare("UPDATE clients SET external_financial_id = ?1, remote_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND organization_id = ?3").bind(parsed.data.externalCustomerId, project.client_id, context.organization.id));
    }
    await context.db.batch(statements);
    return Response.json({ projectId: parsed.data.projectId, externalCostCenterId: parsed.data.externalCostCenterId, customerLinked: Boolean(parsed.data.externalCustomerId) });
  });
}
