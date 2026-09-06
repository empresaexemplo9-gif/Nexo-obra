import { z } from "zod";

import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { createDrapCharge, isDrapChargesConfigured } from "@/lib/integrations/drap";
import { requireActiveDrapConnection } from "@/lib/server/drap";

export const dynamic = "force-dynamic";

const chargeSchema = z.object({
  projectId: z.string().uuid(),
  description: z.string().trim().min(3).max(300),
  amountCents: z.number().int().positive().max(1_000_000_000),
  dueDate: z.string().date(),
  idempotencyKey: z.string().uuid(),
  reminders: z.object({
    daysBefore: z.number().int().min(0).max(30).default(3),
    onDueDate: z.boolean().default(true),
    overdueIntervalDays: z.number().int().min(0).max(30).default(3),
  }),
});

type ChargeRow = {
  id: string; project_id: string; project_name: string; client_id: string | null; client_name: string | null;
  description: string; amount_cents: number; due_date: string; reminder_policy_json: string;
  status: string; external_charge_id: string | null; share_url: string | null; last_error: string | null; created_at: string;
};

function response(row: ChargeRow) {
  return { id: row.id, projectId: row.project_id, projectName: row.project_name, clientId: row.client_id, clientName: row.client_name, description: row.description, amountCents: row.amount_cents, dueDate: row.due_date, reminders: JSON.parse(row.reminder_policy_json) as unknown, status: row.status, externalChargeId: row.external_charge_id, shareUrl: row.share_url, lastError: row.last_error, createdAt: row.created_at };
}

const select = `SELECT r.id, r.project_id, p.name AS project_name, r.client_id, c.name AS client_name,
  r.description, r.amount_cents, r.due_date, r.reminder_policy_json, r.status,
  r.external_charge_id, r.share_url, r.last_error, r.created_at
  FROM financial_charge_requests r
  INNER JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
  LEFT JOIN clients c ON c.id = r.client_id AND c.organization_id = r.organization_id`;

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");
    const projectId = new URL(request.url).searchParams.get("projectId");
    const values: unknown[] = [context.organization.id];
    const filter = projectId ? (values.push(projectId), " AND r.project_id = ?2") : "";
    const result = await context.db.prepare(`${select} WHERE r.organization_id = ?1${filter} ORDER BY r.created_at DESC LIMIT 100`).bind(...values).all<ChargeRow>();
    return Response.json({ charges: result.results.map(response) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "edit");
    if (!isDrapChargesConfigured()) return Response.json({ error: "A criação de cobranças na Drap ainda não foi homologada.", code: "drap_charges_not_configured" }, { status: 503 });
    const parsed = chargeSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;
    const existing = await context.db.prepare(`${select} WHERE r.organization_id = ?1 AND r.idempotency_key = ?2`).bind(context.organization.id, data.idempotencyKey).first<ChargeRow>();
    if (existing) return Response.json({ charge: response(existing), replayed: true });
    const project = await context.db.prepare(`SELECT p.id, p.client_id, p.external_financial_cost_center_id, c.external_financial_id
      FROM projects p LEFT JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
      WHERE p.id = ?1 AND p.organization_id = ?2`).bind(data.projectId, context.organization.id).first<{ id: string; client_id: string | null; external_financial_cost_center_id: string | null; external_financial_id: string | null }>();
    if (!project) throw new ApiError(404, "not_found", "Projeto ou obra não encontrado.");
    if (!project.external_financial_cost_center_id) throw new ApiError(409, "project_cost_center_required", "Vincule esta obra a um centro de custo da Drap.");
    if (!project.client_id || !project.external_financial_id) throw new ApiError(409, "client_financial_link_required", "Vincule o cliente desta obra ao cadastro financeiro da Drap.");
    const connection = await requireActiveDrapConnection(context);
    const id = crypto.randomUUID();
    const reminders = JSON.stringify(data.reminders);
    try {
      await context.db.prepare(`INSERT INTO financial_charge_requests (id, organization_id, project_id, client_id, idempotency_key, description, amount_cents, due_date, reminder_policy_json, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(id, context.organization.id, data.projectId, project.client_id, data.idempotencyKey, data.description, data.amountCents, data.dueDate, reminders).run();
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "charge_request_in_progress", "Esta cobrança já está sendo processada.");
      throw error;
    }
    try {
      const charge = await createDrapCharge({ externalCompanyId: connection.external_company_id, externalCustomerId: project.external_financial_id, costCenterId: project.external_financial_cost_center_id, description: data.description, amountCents: data.amountCents, dueDate: data.dueDate, idempotencyKey: data.idempotencyKey, reminders: data.reminders });
      await context.db.batch([
        context.db.prepare("UPDATE financial_charge_requests SET status = ?1, external_charge_id = ?2, share_url = ?3, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?4 AND organization_id = ?5").bind(charge.status, charge.id, charge.shareUrl, id, context.organization.id),
        auditStatement(context, "financial_charge.created", "financial_charge", id, { projectId: data.projectId }),
      ]);
    } catch {
      await context.db.prepare("UPDATE financial_charge_requests SET status = 'failed', last_error = 'drap_unavailable', updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND organization_id = ?2").bind(id, context.organization.id).run();
      return Response.json({ error: "A Drap não confirmou a cobrança. Nenhum pagamento foi registrado na Nexo Obra.", code: "drap_charge_failed" }, { status: 502 });
    }
    const created = await context.db.prepare(`${select} WHERE r.id = ?1 AND r.organization_id = ?2`).bind(id, context.organization.id).first<ChargeRow>();
    return Response.json({ charge: response(created!) }, { status: 201 });
  });
}
