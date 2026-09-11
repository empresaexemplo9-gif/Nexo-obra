import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  canManageOrganizationAccess,
  ensureFound,
  requireOrganizationContext,
} from "@/lib/server/backend";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ goalId: string }> };

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    if (!canManageOrganizationAccess(context)) {
      throw new ApiError(403, "goal_manager_required", "Somente o contratante ou um administrador encerra metas.");
    }
    const { goalId } = await route.params;
    if (!z.string().uuid().safeParse(goalId).success) throw new ApiError(404, "not_found", "Meta não encontrada.");
    const goal = ensureFound(await context.db.prepare("SELECT id, name FROM goals WHERE id = ?1 AND organization_id = ?2")
      .bind(goalId, context.organization.id).first<{ id: string; name: string }>(), "Meta");
    // A meta é encerrada, não apagada: o histórico de quem definiu o alvo permanece.
    await context.db.batch([
      context.db.prepare("UPDATE goals SET active = 0, updated_at = ?1 WHERE id = ?2 AND organization_id = ?3")
        .bind(Date.now(), goal.id, context.organization.id),
      auditStatement(context, "goal.closed", "goal", goal.id, { name: goal.name }),
    ]);
    return Response.json({ closed: true });
  });
}
