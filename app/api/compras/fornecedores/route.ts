import {
  ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError,
} from "@/lib/server/backend";
import { fornecedorEntrada } from "@/lib/server/compras-entrada";
import { listarFornecedores } from "@/lib/server/compras-cadastros";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    const incluirInativos = new URL(request.url).searchParams.get("inativos") === "1";
    return Response.json({ suppliers: await listarFornecedores(context, incluirInativos) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "edit");
    const parsed = fornecedorEntrada.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const d = parsed.data;
    const id = crypto.randomUUID();
    try {
      await context.db.batch([
        context.db.prepare(
          `INSERT INTO suppliers (id, organization_id, name, document, contact_name, email, phone, city, uf, categories, payment_terms, lead_time_days, negotiation_score, notes, active, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ).bind(id, context.organization.id, d.name, d.document || null, d.contactName, d.email, d.phone, d.city, d.uf, d.categories, d.paymentTerms, d.leadTimeDays, d.negotiationScore, d.notes),
        auditStatement(context, "supplier.created", "supplier", id, { name: d.name }),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "supplier_document_conflict", "Já existe fornecedor com este CPF/CNPJ.");
      throw error;
    }
    const supplier = (await listarFornecedores(context, true)).find((s) => s.id === id);
    return Response.json({ supplier }, { status: 201 });
  });
}
