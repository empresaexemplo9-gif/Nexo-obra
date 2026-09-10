import { getDb } from "@/db";
import { assertCan } from "@/lib/auth/roles";
import { requireAuth } from "@/lib/auth/session";
import { assertTaskRelations, deleteTask, getTask, updateTask } from "@/lib/data/tasks";
import { updateTaskSchema } from "@/lib/domain/schemas";
import { apiError, handleRoute, parseJsonBody } from "@/lib/server/api";
import { diffChanges, recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "task:read");

    const { id } = await context.params;
    const task = await getTask(getDb(), auth.active.organizationId, id);
    if (!task) return apiError(404, "not_found", "Tarefa não encontrada.");

    return Response.json({ task });
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "task:write");

    const { id } = await context.params;
    const body = await parseJsonBody(request, updateTaskSchema);
    if (!body.ok) return body.response;

    const db = getDb();
    const organizationId = auth.active.organizationId;

    const before = await getTask(db, organizationId, id);
    if (!before) return apiError(404, "not_found", "Tarefa não encontrada.");

    const relations = await assertTaskRelations(db, organizationId, body.data);
    if (!relations.ok) {
      return apiError(422, "invalid_input", "Referência inválida para esta empresa.", {
        fields: [
          {
            field: relations.field,
            message:
              relations.field === "projectId"
                ? "Trabalho não encontrado nesta empresa."
                : "Responsável não encontrado nesta empresa.",
          },
        ],
      });
    }

    const updated = await updateTask(db, organizationId, id, body.data);
    if (!updated) return apiError(404, "not_found", "Tarefa não encontrada.");

    const changedStatus = body.data.status !== undefined && body.data.status !== before.status;

    await recordAudit(db, {
      organizationId,
      actorMemberId: auth.active.memberId,
      entity: "task",
      entityId: id,
      action: changedStatus ? "status_change" : "update",
      changes: diffChanges(before, body.data),
    });

    return Response.json({ task: updated });
  });
}

export async function DELETE(_request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "task:write");

    const { id } = await context.params;
    const db = getDb();

    const deleted = await deleteTask(db, auth.active.organizationId, id);
    if (!deleted) return apiError(404, "not_found", "Tarefa não encontrada.");

    await recordAudit(db, {
      organizationId: auth.active.organizationId,
      actorMemberId: auth.active.memberId,
      entity: "task",
      entityId: id,
      action: "delete",
    });

    return new Response(null, { status: 204 });
  });
}
