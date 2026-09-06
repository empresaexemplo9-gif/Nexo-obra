import { z } from "zod";

import {
  ApiError,
  apiRoute,
  auditStatement,
  jsonBody,
  operationalRoles,
  requireOrganizationContext,
  validationError,
} from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const createClientSchema = z.object({
  name: z.string().trim().min(2).max(160),
  document: z.string().trim().max(24).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(4000).default(""),
  externalFinancialId: z.string().trim().max(120).nullable().optional(),
});

type ClientRow = {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  notes: string;
  external_financial_id: string | null;
  created_at: string;
  updated_at: string;
};

function clientResponse(row: ClientRow) {
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

const clientColumns = `
  id, name, document, email, phone, notes, external_financial_id,
  created_at, updated_at
`;

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const statement = query
      ? context.db
          .prepare(
            `SELECT ${clientColumns}
             FROM clients
             WHERE organization_id = ?1
               AND (name LIKE ?2 OR email LIKE ?2 OR phone LIKE ?2 OR document LIKE ?2)
             ORDER BY name
             LIMIT 100`,
          )
          .bind(context.organization.id, `%${query}%`)
      : context.db
          .prepare(
            `SELECT ${clientColumns}
             FROM clients
             WHERE organization_id = ?1
             ORDER BY name
             LIMIT 100`,
          )
          .bind(context.organization.id);

    const result = await statement.all<ClientRow>();
    return Response.json({ clients: result.results.map(clientResponse) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request, operationalRoles);
    const parsed = createClientSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);

    const clientId = crypto.randomUUID();
    const data = parsed.data;
    try {
      await context.db.batch([
        context.db
          .prepare(
            `INSERT INTO clients (
              id, organization_id, name, document, email, phone,
              external_financial_id, remote_id, notes, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(
            clientId,
            context.organization.id,
            data.name,
            data.document ?? null,
            data.email ?? null,
            data.phone ?? null,
            data.externalFinancialId ?? null,
            data.notes,
          ),
        auditStatement(context, "client.created", "client", clientId),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) {
        throw new ApiError(409, "client_conflict", "Já existe um cliente com esse vínculo financeiro.");
      }
      throw error;
    }

    const client = await context.db
      .prepare(`SELECT ${clientColumns} FROM clients WHERE id = ?1 AND organization_id = ?2`)
      .bind(clientId, context.organization.id)
      .first<ClientRow>();

    return Response.json({ client: clientResponse(client!) }, { status: 201 });
  });
}
