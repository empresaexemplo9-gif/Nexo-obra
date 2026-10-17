import { z } from "zod";

import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { loadProposalByToken } from "@/lib/server/proposals";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";
import { requestEvidenceHashes } from "@/lib/server/terms";
import { validUntil } from "@/lib/proposals";

export const dynamic = "force-dynamic";

// Aceite do cliente dentro da proposta recebida.
//
// O cliente não tem conta; o link assinado é a credencial. Como evidência ficam o nome
// e o documento informados, a data, o hash do IP e do navegador e uma cópia exata do
// conteúdo e do total aceitos — editar a proposta depois não muda o que foi aceito.
//
// `version` é o `updated_at` da proposta que a página mostrou. Se a equipe editou a
// proposta depois que o cliente abriu, o aceite é recusado e a página pede para recarregar:
// ninguém aceita uma versão que não leu.

const acceptSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo.").max(160),
  document: z.string().trim().max(30).transform((value) => value || null).nullable().optional(),
  agree: z.literal(true, { message: "Confirme que leu e está de acordo." }),
  version: z.number().int().positive(),
}).strict();

export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const { token } = await route.params;
    const parsed = acceptSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const db = getDatabase();
    const row = await loadProposalByToken(db, token);
    if (!row) throw new ApiError(404, "proposal_not_found", "Proposta não encontrada ou fora do ar.");
    if (row.status === "accepted") throw new ApiError(409, "proposal_already_accepted", "Esta proposta já foi aceita.");
    const issuedAt = row.issued_at ?? row.sent_at ?? row.created_at;
    if (Date.now() > validUntil(issuedAt, Number(row.validity_days))) {
      throw new ApiError(410, "proposal_expired", "O prazo de validade desta proposta terminou. Peça uma proposta atualizada.");
    }
    if (parsed.data.version !== Number(row.updated_at)) {
      throw new ApiError(409, "proposal_changed", "A proposta foi atualizada depois que você abriu. Recarregue a página para ler a versão atual.");
    }
    const evidence = await requestEvidenceHashes(request);
    const now = Date.now();
    const snapshot = JSON.stringify({ title: row.title, totalCents: Number(row.total_cents), content: JSON.parse(row.content_json), version: row.updated_at });
    const result = await db.prepare(
      `UPDATE proposals SET status = 'accepted', accepted_at = ?1, accepted_name = ?2, accepted_document = ?3,
         accepted_snapshot_json = ?4, accepted_ip_hash = ?5, accepted_user_agent_hash = ?6,
         first_viewed_at = COALESCE(first_viewed_at, ?1), last_viewed_at = ?1
       WHERE id = ?7 AND status = 'sent' AND updated_at = ?8`,
    ).bind(now, parsed.data.name, parsed.data.document ?? null, snapshot, evidence.ipHash, evidence.userAgentHash, row.id, row.updated_at).run();
    if (!result.meta?.changes) throw new ApiError(409, "proposal_changed", "A proposta mudou enquanto você lia. Recarregue a página.");
    return Response.json({ accepted: true, acceptedAt: now, acceptedName: parsed.data.name });
  });
}
