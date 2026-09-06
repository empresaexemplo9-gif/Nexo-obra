import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  ensureFound,
  jsonBody,
  managementRoles,
  operationalRoles,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const updateClientSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  document: z.string().trim().max(24).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
  externalFinancialId: z.string().trim().max(120).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

type RouteContext = { params: Promise<{ clientId: string }> };
type ClientRow = Record<string, string | null>;

const clientSelect = `SELECT
  id, name, document, email, phone, notes, external_financial_id,
  created_at, updated_at
  FROM clients WHERE id = ?1 AND organization_id = ?2`;

function serialize(row: ClientRow) {
  return {
    id: row.id,
    name: row.name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    externalFinancialId: row.external_financial_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { clientId } = await route.params;
    const client = ensureFound(
      await context.db.prepare(clientSelect).bind(clientId, context.organization.id).first<ClientRow>(),
      "Cliente",
    );
    return Response.json({ client: serialize(client) });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, operationalRoles);
    const { clientId } = await route.params;
    ensureFound(
      await context.db.prepare("SELECT id FROM clients WHERE id = ?1 AND organization_id = ?2")
        .bind(clientId, context.organization.id).first(),
      "Cliente",
    );

    const parsed = updateClientSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);

    const columns: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      columns.push(`${column} = ?${values.length + 1}`);
      values.push(value);
    };
    const data = parsed.data;
    if (data.name !== undefined) add("name", data.name);
    if (data.document !== undefined) add("document", data.document);
    if (data.email !== undefined) add("email", data.email);
    if (data.phone !== undefined) add("phone", data.phone);
    if (data.notes !== undefined) add("notes", data.notes);
    if (data.externalFinancialId !== undefined) {
      add("external_financial_id", data.externalFinancialId);
      add("remote_id", data.externalFinancialId);
    }
    columns.push("updated_at = CURRENT_TIMESTAMP");
    const idPosition = values.length + 1;
    const orgPosition = values.length + 2;

    await context.db.batch([
      context.db
        .prepare(`UPDATE clients SET ${columns.join(", ")} WHERE id = ?${idPosition} AND organization_id = ?${orgPosition}`)
        .bind(...values, clientId, context.organization.id),
      auditStatement(context, "client.updated", "client", clientId, { fields: Object.keys(data) }),
    ]);

    const client = ensureFound(
      await context.db.prepare(clientSelect).bind(clientId, context.organization.id).first<ClientRow>(),
      "Cliente",
    );
    return Response.json({ client: serialize(client) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, managementRoles);
    const { clientId } = await route.params;
    ensureFound(
      await context.db.prepare("SELECT id FROM clients WHERE id = ?1 AND organization_id = ?2")
        .bind(clientId, context.organization.id).first(),
      "Cliente",
    );

    const linked = await context.db
      .prepare("SELECT COUNT(*) AS total FROM projects WHERE client_id = ?1 AND organization_id = ?2")
      .bind(clientId, context.organization.id)
      .first<{ total: number }>();
    if ((linked?.total ?? 0) > 0) {
      throw new ApiError(409, "client_in_use", "Remova ou transfira os projetos deste cliente antes de excluí-lo.");
    }

    await context.db.batch([
      context.db.prepare("DELETE FROM clients WHERE id = ?1 AND organization_id = ?2")
        .bind(clientId, context.organization.id),
      auditStatement(context, "client.deleted", "client", clientId),
    ]);
    return new Response(null, { status: 204 });
  });
}
