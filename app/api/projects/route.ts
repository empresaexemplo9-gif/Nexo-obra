import { getDb } from "@/db";
import { assertCan } from "@/lib/auth/roles";
import { requireAuth } from "@/lib/auth/session";
import {
  assertRelationsBelongToOrganization,
  createProject,
  isCodeTaken,
  listProjects,
} from "@/lib/data/projects";
import { createProjectSchema, listProjectsQuerySchema } from "@/lib/domain/schemas";
import { apiError, handleRoute, parseJsonBody, parseSearchParams } from "@/lib/server/api";
import { recordAudit } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

/**
 * Projetos e obras.
 *
 * O header `x-organization-id` que esta rota usava foi removido: a organização
 * agora vem de `requireAuth()`, que a resolve pela sessão e confere o vínculo
 * do usuário no banco. Não reintroduza um caminho em que o cliente escolha a
 * empresa — era exatamente o furo que a Fase 1 fechou.
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "project:read");

    const query = parseSearchParams(request, listProjectsQuerySchema);
    if (!query.ok) return query.response;

    const result = await listProjects(getDb(), auth.active.organizationId, query.data);
    return Response.json(result);
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const auth = await requireAuth();
    assertCan(auth.active.role, "project:write");

    const body = await parseJsonBody(request, createProjectSchema);
    if (!body.ok) return body.response;

    const db = getDb();
    const organizationId = auth.active.organizationId;

    // Cliente e responsável precisam ser desta empresa. A FK do banco só exige
    // que a linha exista em algum lugar — o recorte por empresa é aqui.
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

    if (await isCodeTaken(db, organizationId, body.data.code)) {
      return apiError(409, "conflict", `Já existe um trabalho com o código ${body.data.code}.`);
    }

    const created = await createProject(db, organizationId, body.data);

    await recordAudit(db, {
      organizationId,
      actorMemberId: auth.active.memberId,
      entity: "project",
      entityId: created.id,
      action: "create",
      changes: {
        code: { from: null, to: created.code },
        name: { from: null, to: created.name },
        kind: { from: null, to: created.kind },
      },
    });

    return Response.json({ project: created }, { status: 201 });
  });
}
