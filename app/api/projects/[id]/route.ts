import { getDb } from "@/db";
import { assertCan } from "@/lib/auth/roles";
import { requireAuth } from "@/lib/auth/session";
import {
  assertRelationsBelongToOrganization,
  deleteProject,
  getProject,
  isCodeTaken,
  updateProject,
} from "@/lib/data/projects";
import { updateProjectSchema } from "@/lib/domain/schemas";
import { apiError, handleRoute, parseJsonBody } from "@/lib/server/api";
import { diffChanges, recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "project:read");

    const { id } = await context.params;
    const project = await getProject(getDb(), auth.active.organizationId, id);
    if (!project) return apiError(404, "not_found", "Trabalho não encontrado.");

    return Response.json({ project });
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "project:write");

    const { id } = await context.params;
    const body = await parseJsonBody(request, updateProjectSchema);
    if (!body.ok) return body.response;

    const db = getDb();
    const organizationId = auth.active.organizationId;

    const before = await getProject(db, organizationId, id);
    if (!before) return apiError(404, "not_found", "Trabalho não encontrado.");

    const relations = await assertRelationsBelongToOrganization(db, organizationId, body.data);
    if (!relations.ok) {
      return apiError(422, "invalid_input", "Referência inválida para esta empresa.", {
        fields: [
          {
            field: relations.field,
            message:
              relations.field === "clientId"
                ? "Cliente não encontrado nesta empresa."
                : "Responsável não encontrado nesta empresa.",
          },
        ],
      });
    }

    if (body.data.code && (await isCodeTaken(db, organizationId, body.data.code, id))) {
      return apiError(409, "conflict", `Já existe um trabalho com o código ${body.data.code}.`);
    }

    const updated = await updateProject(db, organizationId, id, body.data);
    if (!updated) return apiError(404, "not_found", "Trabalho não encontrado.");

    // Mudança de situação é auditada como evento próprio: é o que se procura
    // depois quando alguém pergunta "quem pausou esta obra?".
    const changedStatus = body.data.status !== undefined && body.data.status !== before.status;

    await recordAudit(db, {
      organizationId,
      actorMemberId: auth.active.memberId,
      entity: "project",
      entityId: id,
      action: changedStatus ? "status_change" : "update",
      changes: diffChanges(before, body.data),
    });

    return Response.json({ project: updated });
  });
}

export async function DELETE(_request: Request, context: Context) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "project:write");

    const { id } = await context.params;
    const db = getDb();

    const deleted = await deleteProject(db, auth.active.organizationId, id);
    if (!deleted) return apiError(404, "not_found", "Trabalho não encontrado.");

    await recordAudit(db, {
      organizationId: auth.active.organizationId,
      actorMemberId: auth.active.memberId,
      entity: "project",
      entityId: id,
      action: "delete",
    });

    return new Response(null, { status: 204 });
  });
}
