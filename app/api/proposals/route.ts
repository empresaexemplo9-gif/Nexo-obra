import { z } from "zod";

import { ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { newLinkNonce, nextProposalCode, proposalResponse, proposalSelect, type ProposalRow } from "@/lib/server/proposals";
import { defaultProposalContent, newId, proposalTotals, type ProposalItem } from "@/lib/proposals";

export const dynamic = "force-dynamic";

// Proposta pertence à empresa e segue a permissão de Orçamentos: quem vê orçamento vê
// proposta; quem edita orçamento cria, edita e envia proposta.

const createSchema = z.object({
  budgetVersionId: z.string().trim().min(1).max(80).nullable().optional(),
  projectId: z.string().trim().min(1).max(80).nullable().optional(),
  clientId: z.string().trim().min(1).max(80).nullable().optional(),
  title: z.string().trim().min(2, "Dê um título à proposta.").max(160),
}).strict();

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "view");
    const rows = await context.db.prepare(`${proposalSelect} WHERE pr.organization_id = ?1 ORDER BY pr.updated_at DESC LIMIT 300`)
      .bind(context.organization.id).all<ProposalRow>();
    const origin = new URL(request.url).origin;
    return Response.json(
      { proposals: await Promise.all(rows.results.map((row) => proposalResponse(row, origin))), now: Date.now() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

type ClientRow = { id: string; name: string; email: string | null; phone: string | null };

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "budgets", "edit");
    const parsed = createSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const { db, organization } = context;
    const data = parsed.data;

    let projectId = data.projectId ?? null;
    let items: ProposalItem[] = [];
    if (data.budgetVersionId) {
      const budget = ensureFound(await db.prepare("SELECT id, project_id FROM budget_versions WHERE id = ?1 AND organization_id = ?2")
        .bind(data.budgetVersionId, organization.id).first<{ id: string; project_id: string | null }>(), "Orçamento");
      projectId = budget.project_id ?? projectId;
      const rows = await db.prepare("SELECT description, unit, quantity, unit_price_cents FROM budget_items WHERE budget_version_id = ?1 ORDER BY sort_order")
        .bind(budget.id).all<{ description: string; unit: string; quantity: number; unit_price_cents: number }>();
      items = rows.results.map((row) => ({
        id: newId(), description: row.description.slice(0, 500), unit: (row.unit || "un").slice(0, 20),
        quantity: Number(row.quantity), unitPriceCents: Number(row.unit_price_cents),
      }));
    }

    let clientId = data.clientId ?? null;
    if (projectId) {
      const project = ensureFound(await db.prepare("SELECT id, client_id FROM projects WHERE id = ?1 AND organization_id = ?2")
        .bind(projectId, organization.id).first<{ id: string; client_id: string | null }>(), "Projeto");
      clientId = clientId ?? project.client_id;
    }
    let client: ClientRow | null = null;
    if (clientId) {
      client = ensureFound(await db.prepare("SELECT id, name, email, phone FROM clients WHERE id = ?1 AND organization_id = ?2")
        .bind(clientId, organization.id).first<ClientRow>(), "Cliente");
    }

    const content = defaultProposalContent(items);
    const now = Date.now();
    const id = crypto.randomUUID();
    // Duas propostas criadas no mesmo instante disputam o mesmo número; a segunda tenta de novo.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = await nextProposalCode(db, organization.id);
      try {
        await db.batch([
          db.prepare(
            `INSERT INTO proposals (id, organization_id, project_id, client_id, budget_version_id, code, title, recipient_name,
               recipient_email, recipient_phone, content_json, total_cents, validity_days, status, link_nonce, created_by_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 15, 'draft', ?13, ?14, ?15, ?15)`,
          ).bind(id, organization.id, projectId, client?.id ?? null, data.budgetVersionId ?? null, code, data.title,
            client?.name ?? "", client?.email ?? null, client?.phone ?? null, JSON.stringify(content),
            proposalTotals(content).totalCents, newLinkNonce(), context.user.displayName, now),
          auditStatement(context, "proposal.created", "proposal", id, { code, budgetVersionId: data.budgetVersionId ?? null }),
        ]);
        break;
      } catch (error) {
        if (attempt < 2 && String(error).includes("UNIQUE constraint failed: proposals.organization_id, proposals.code")) continue;
        if (String(error).includes("UNIQUE constraint failed")) throw new ApiError(409, "proposal_code_conflict", "Não foi possível numerar a proposta. Tente de novo.");
        throw error;
      }
    }
    const row = ensureFound(await db.prepare(`${proposalSelect} WHERE pr.id = ?1 AND pr.organization_id = ?2`)
      .bind(id, organization.id).first<ProposalRow>(), "Proposta");
    return Response.json({ proposal: await proposalResponse(row, new URL(request.url).origin, true) }, { status: 201 });
  });
}
