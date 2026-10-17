import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { parseContent, proposalResponse, proposalSelect, type ProposalRow } from "@/lib/server/proposals";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ proposalId: string }> };

// Agendamento de envio. O envio sai pelo e-mail ou WhatsApp do próprio usuário, então a
// plataforma não dispara sozinha: na hora marcada a proposta vira "hora de enviar" nos
// lembretes e no topo da aba Propostas, com o botão que abre o canal com tudo pronto.
// Enquanto agendada, o link continua fora do ar: o cliente não lê antes da hora.

const scheduleSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  at: z.string().datetime({ offset: true, message: "Informe data e hora válidas." }),
}).strict();

const ONE_YEAR = 366 * 86_400_000;

async function load(context: Awaited<ReturnType<typeof requireOrganizationContext>>, proposalId: string) {
  return ensureFound(await context.db.prepare(`${proposalSelect} WHERE pr.id = ?1 AND pr.organization_id = ?2`)
    .bind(proposalId, context.organization.id).first<ProposalRow>(), "Proposta");
}

export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const { proposalId } = await route.params;
    const parsed = scheduleSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const at = Date.parse(parsed.data.at);
    const now = Date.now();
    if (at <= now + 60_000) throw new ApiError(400, "schedule_in_past", "Escolha um horário a partir do próximo minuto.");
    if (at > now + ONE_YEAR) throw new ApiError(400, "schedule_too_far", "Agende para no máximo um ano à frente.");
    const current = await load(context, proposalId);
    if (current.status !== "draft" && current.status !== "scheduled") {
      throw new ApiError(409, "proposal_not_schedulable", "Só rascunho pode ser agendado. Esta proposta já foi enviada.");
    }
    if (parseContent(current.content_json).items.length === 0) {
      throw new ApiError(409, "proposal_empty", "Inclua ao menos um item no investimento antes de agendar.");
    }
    if (parsed.data.channel === "email" && !current.recipient_email) throw new ApiError(409, "recipient_email_missing", "Informe o e-mail do cliente antes de agendar por e-mail.");
    const result = await context.db.batch([
      context.db.prepare("UPDATE proposals SET status = 'scheduled', scheduled_at = ?1, scheduled_channel = ?2, updated_at = ?3 WHERE id = ?4 AND organization_id = ?5 AND status IN ('draft', 'scheduled')")
        .bind(at, parsed.data.channel, now, proposalId, context.organization.id),
      auditStatement(context, "proposal.scheduled", "proposal", proposalId, { at, channel: parsed.data.channel }),
    ]);
    if (!result[0]?.meta?.changes) throw new ApiError(409, "proposal_locked", "A proposta mudou de situação. Recarregue.");
    return Response.json({ proposal: await proposalResponse(await load(context, proposalId), new URL(request.url).origin, true) });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const { proposalId } = await route.params;
    const current = await load(context, proposalId);
    if (current.status !== "scheduled") throw new ApiError(409, "proposal_not_scheduled", "Esta proposta não está agendada.");
    await context.db.batch([
      context.db.prepare("UPDATE proposals SET status = 'draft', scheduled_at = NULL, scheduled_channel = NULL, updated_at = ?1 WHERE id = ?2 AND organization_id = ?3 AND status = 'scheduled'")
        .bind(Date.now(), proposalId, context.organization.id),
      auditStatement(context, "proposal.schedule_cancelled", "proposal", proposalId),
    ]);
    return Response.json({ proposal: await proposalResponse(await load(context, proposalId), new URL(request.url).origin, true) });
  });
}
