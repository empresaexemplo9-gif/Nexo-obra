import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { proposalResponse, proposalSelect, type ProposalRow } from "@/lib/server/proposals";
import { proposalContentSchema, proposalTotals } from "@/lib/proposals";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ proposalId: string }> };

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable();

const updateSchema = z.object({
  title: z.string().trim().min(2, "Dê um título à proposta.").max(160).optional(),
  recipientName: z.string().trim().max(160).optional(),
  recipientEmail: optionalText(200).refine((value) => value === null || z.string().email().safeParse(value).success, "E-mail inválido.").optional(),
  recipientPhone: optionalText(40).optional(),
  validityDays: z.number().int().min(1, "Validade mínima de 1 dia.").max(365).optional(),
  content: proposalContentSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

async function load(context: Awaited<ReturnType<typeof requireOrganizationContext>>, proposalId: string) {
  return ensureFound(await context.db.prepare(`${proposalSelect} WHERE pr.id = ?1 AND pr.organization_id = ?2`)
    .bind(proposalId, context.organization.id).first<ProposalRow>(), "Proposta");
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    const { proposalId } = await route.params;
    const row = await load(context, proposalId);
    // Abrir a proposta é ver o aviso de abertura ou aceite: o lembrete some depois disso.
    const response = await proposalResponse(row, new URL(request.url).origin, true);
    if (response.unseenNotice) {
      await context.db.prepare("UPDATE proposals SET notice_ack_at = ?1 WHERE id = ?2 AND organization_id = ?3")
        .bind(Date.now(), row.id, context.organization.id).run();
    }
    return Response.json({ proposal: response }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const { proposalId } = await route.params;
    const current = await load(context, proposalId);
    if (current.status === "accepted") throw new ApiError(409, "proposal_accepted", "A proposta já foi aceita e está travada. Crie uma nova para alterar.");
    if (current.status === "cancelled") throw new ApiError(409, "proposal_cancelled", "A proposta foi cancelada.");
    const parsed = updateSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const data = parsed.data;

    const columns: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => { values.push(value); columns.push(`${column} = ?${values.length}`); };
    if (data.title !== undefined) add("title", data.title);
    if (data.recipientName !== undefined) add("recipient_name", data.recipientName);
    if (data.recipientEmail !== undefined) add("recipient_email", data.recipientEmail);
    if (data.recipientPhone !== undefined) add("recipient_phone", data.recipientPhone);
    if (data.validityDays !== undefined) add("validity_days", data.validityDays);
    if (data.content !== undefined) {
      add("content_json", JSON.stringify(data.content));
      // O total é sempre do servidor: o navegador manda itens, nunca o valor final.
      add("total_cents", proposalTotals(data.content).totalCents);
    }
    add("updated_at", Date.now());
    values.push(proposalId, context.organization.id);
    // O status entra no WHERE: aceite e edição ao mesmo tempo não podem os dois vencer.
    const result = await context.db.batch([
      context.db.prepare(`UPDATE proposals SET ${columns.join(", ")} WHERE id = ?${values.length - 1} AND organization_id = ?${values.length} AND status NOT IN ('accepted', 'cancelled')`)
        .bind(...values),
      auditStatement(context, "proposal.updated", "proposal", proposalId, { fields: Object.keys(data) }),
    ]);
    if (!result[0]?.meta?.changes) throw new ApiError(409, "proposal_locked", "A proposta mudou de situação enquanto você editava. Recarregue.");
    return Response.json({ proposal: await proposalResponse(await load(context, proposalId), new URL(request.url).origin, true) });
  });
}

// Cancelar tira o link do ar e encerra a proposta. Aceita não se cancela: o aceite fica.
export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const { proposalId } = await route.params;
    const current = await load(context, proposalId);
    if (current.status === "accepted") throw new ApiError(409, "proposal_accepted", "A proposta já foi aceita e não pode ser cancelada.");
    if (current.status === "cancelled") return Response.json({ proposal: await proposalResponse(current, new URL(request.url).origin, true) });
    const result = await context.db.batch([
      context.db.prepare("UPDATE proposals SET status = 'cancelled', scheduled_at = NULL, scheduled_channel = NULL, updated_at = ?1 WHERE id = ?2 AND organization_id = ?3 AND status NOT IN ('accepted', 'cancelled')")
        .bind(Date.now(), proposalId, context.organization.id),
      auditStatement(context, "proposal.cancelled", "proposal", proposalId),
    ]);
    if (!result[0]?.meta?.changes) throw new ApiError(409, "proposal_locked", "A proposta mudou de situação. Recarregue.");
    return Response.json({ proposal: await proposalResponse(await load(context, proposalId), new URL(request.url).origin, true) });
  });
}
