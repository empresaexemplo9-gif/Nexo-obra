import { z } from "zod";

import {
  ApiError, apiRoute, auditStatement, ensureFound, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { fornecedorEntrada } from "@/lib/server/compras-entrada";
import { listarFornecedores } from "@/lib/server/compras-cadastros";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ supplierId: string }> };

async function fornecedorDaRota(request: Request, route: RouteContext) {
  const context = await requireOrganizationContext(request);
  requireModulePermission(context, "purchases", "edit");
  const { supplierId } = await route.params;
  if (!z.string().uuid().safeParse(supplierId).success) throw new ApiError(404, "not_found", "Fornecedor não encontrado.");
  ensureFound(await context.db.prepare("SELECT id FROM suppliers WHERE id = ?1 AND organization_id = ?2").bind(supplierId, context.organization.id).first(), "Fornecedor");
  return { context, supplierId };
}

export async function PATCH(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { context, supplierId } = await fornecedorDaRota(request, route);
    const corpo = await jsonBody(request) as Record<string, unknown>;
    const ativo = typeof corpo?.active === "boolean" ? corpo.active : null;
    const { active: _ignorado, ...resto } = corpo ?? {};
    void _ignorado;
    const parsed = fornecedorEntrada.safeParse(resto);
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const d = parsed.data;
    try {
      await context.db.batch([
        context.db.prepare(
          `UPDATE suppliers SET name = ?1, document = ?2, contact_name = ?3, email = ?4, phone = ?5, city = ?6, uf = ?7, categories = ?8,
             payment_terms = ?9, lead_time_days = ?10, negotiation_score = ?11, notes = ?12, active = COALESCE(?13, active), updated_at = CURRENT_TIMESTAMP
           WHERE id = ?14 AND organization_id = ?15`,
        ).bind(d.name, d.document || null, d.contactName, d.email, d.phone, d.city, d.uf, d.categories, d.paymentTerms, d.leadTimeDays, d.negotiationScore, d.notes, ativo === null ? null : ativo ? 1 : 0, supplierId, context.organization.id),
        auditStatement(context, "supplier.updated", "supplier", supplierId, { active: ativo }),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "supplier_document_conflict", "Já existe fornecedor com este CPF/CNPJ.");
      throw error;
    }
    return Response.json({ supplier: (await listarFornecedores(context, true)).find((s) => s.id === supplierId) });
  });
}

// O fornecedor é desativado, não apagado: as cotações e compras antigas continuam
// apontando para ele e dizendo de quem foi comprado.
export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const { context, supplierId } = await fornecedorDaRota(request, route);
    await context.db.batch([
      context.db.prepare("UPDATE suppliers SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND organization_id = ?2").bind(supplierId, context.organization.id),
      auditStatement(context, "supplier.deactivated", "supplier", supplierId),
    ]);
    return Response.json({ deactivated: true });
  });
}
