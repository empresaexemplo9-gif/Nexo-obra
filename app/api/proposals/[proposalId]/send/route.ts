import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { parseContent, proposalResponse, proposalSelect, type ProposalRow } from "@/lib/server/proposals";
import { PROPOSAL_CHANNELS } from "@/lib/proposals";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ proposalId: string }> };

const sendSchema = z.object({ channel: z.enum(PROPOSAL_CHANNELS) }).strict();

// Envio pelo e-mail ou WhatsApp do próprio usuário: a plataforma não tem provedor de
// mensagem, então ela não diz "entregue". Ela registra que o usuário abriu o canal com o
// link pronto, data a proposta e põe o link no ar. A confirmação de que chegou é o
// cliente abrir a proposta — e isso, sim, a plataforma vê e avisa.
//
// A data e a hora da proposta são do primeiro envio. Reenviar não muda a emissão.
export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const { proposalId } = await route.params;
    const parsed = sendSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const { channel } = parsed.data;
    const { db, organization } = context;
    const current = ensureFound(await db.prepare(`${proposalSelect} WHERE pr.id = ?1 AND pr.organization_id = ?2`)
      .bind(proposalId, organization.id).first<ProposalRow>(), "Proposta");
    if (current.status === "cancelled") throw new ApiError(409, "proposal_cancelled", "A proposta foi cancelada.");
    if (current.status === "accepted") throw new ApiError(409, "proposal_accepted", "A proposta já foi aceita.");
    if (parseContent(current.content_json).items.length === 0) {
      throw new ApiError(409, "proposal_empty", "Inclua ao menos um item no investimento antes de enviar.");
    }
    if (channel === "email" && !current.recipient_email) throw new ApiError(409, "recipient_email_missing", "Informe o e-mail do cliente antes de enviar por e-mail.");

    const now = Date.now();
    const result = await db.batch([
      db.prepare(
        `UPDATE proposals SET status = 'sent', issued_at = COALESCE(issued_at, ?1), sent_at = ?1, sent_channel = ?2,
           scheduled_at = NULL, scheduled_channel = NULL, updated_at = CASE WHEN status = 'sent' THEN updated_at ELSE ?1 END
         WHERE id = ?3 AND organization_id = ?4 AND status IN ('draft', 'scheduled', 'sent')`,
      ).bind(now, channel, proposalId, organization.id),
      auditStatement(context, "proposal.sent", "proposal", proposalId, { channel, resend: current.status === "sent" }),
    ]);
    if (!result[0]?.meta?.changes) throw new ApiError(409, "proposal_locked", "A proposta mudou de situação. Recarregue.");
    const row = ensureFound(await db.prepare(`${proposalSelect} WHERE pr.id = ?1 AND pr.organization_id = ?2`)
      .bind(proposalId, organization.id).first<ProposalRow>(), "Proposta");
    return Response.json({ proposal: await proposalResponse(row, new URL(request.url).origin, true) });
  });
}
