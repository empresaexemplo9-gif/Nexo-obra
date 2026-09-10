import { getDb } from "@/db";
import { assertCan } from "@/lib/auth/roles";
import { requireAuth } from "@/lib/auth/session";
import { assertTaskRelations, createTask, listTasks } from "@/lib/data/tasks";
import { createTaskSchema, listTasksQuerySchema } from "@/lib/domain/schemas";
import { apiError, handleRoute, parseJsonBody, parseSearchParams } from "@/lib/server/api";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "task:read");

    const query = parseSearchParams(request, listTasksQuerySchema);
    if (!query.ok) return query.response;

    const { status, ...rest } = query.data;
    const result = await listTasks(getDb(), auth.active.organizationId, {
      ...rest,
      statuses: status ? [status] : undefined,
    });

    return Response.json(result);
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "task:write");

    const body = await parseJsonBody(request, createTaskSchema);
    if (!body.ok) return body.response;

    const db = getDb();
    const organizationId = auth.active.organizationId;

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

    const created = await createTask(db, organizationId, body.data);

    await recordAudit(db, {
      organizationId,
      actorMemberId: auth.active.memberId,
      entity: "task",
      entityId: created.id,
      action: "create",
      changes: {
        title: { from: null, to: created.title },
        projectId: { from: null, to: created.projectId },
      },
    });

    return Response.json({ task: created }, { status: 201 });
  });
}
