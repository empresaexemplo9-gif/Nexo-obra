import { createHash } from "node:crypto";

import { ApiError, type OrganizationContext } from "@/lib/server/backend";
import { lerTabelaDePrecos } from "@/lib/integrations/goinfra-planilha";

// Lista de preços enviada pela loja. Substitui a anterior do mesmo fornecedor num único
// lote transacional: ou a lista nova inteira, ou a antiga intacta.

export const LIMITE_ITENS_LISTA = 3000;

export async function importarListaDePrecos(context: OrganizationContext, supplierId: string, arquivo: { nome: string; bytes: Buffer }, validOn: string) {
  let lido;
  try { lido = lerTabelaDePrecos(arquivo.bytes, arquivo.nome, false); }
  catch (error) { throw new ApiError(422, "price_list_invalid", `Não foi possível ler a lista: ${error instanceof Error ? error.message : String(error)}`); }
  if (!lido.itens.length) throw new ApiError(422, "price_list_empty", "A lista não tem itens com descrição, unidade e preço.");
  if (lido.itens.length > LIMITE_ITENS_LISTA) throw new ApiError(422, "price_list_too_large", `A lista tem ${lido.itens.length} itens; o limite é ${LIMITE_ITENS_LISTA}. Envie só as categorias que a empresa compra.`);
  const org = context.organization.id;
  const anterior = await context.db.prepare("SELECT id FROM supplier_price_lists WHERE organization_id = ?1 AND supplier_id = ?2").bind(org, supplierId).first<{ id: string }>();
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await context.db.batch([
    ...(anterior ? [
      context.db.prepare("DELETE FROM supplier_price_items WHERE list_id = ?1 AND organization_id = ?2").bind(anterior.id, org),
      context.db.prepare("DELETE FROM supplier_price_lists WHERE id = ?1 AND organization_id = ?2").bind(anterior.id, org),
    ] : []),
    context.db.prepare(
      `INSERT INTO supplier_price_lists (id, organization_id, supplier_id, file_name, sha256, valid_on, total_items, ignored, imported_by_name, imported_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(id, org, supplierId, arquivo.nome.slice(0, 200), createHash("sha256").update(arquivo.bytes).digest("hex"), validOn, lido.itens.length, lido.ignoradas, context.user.displayName, agora),
    ...lido.itens.map((item) => context.db.prepare(
      "INSERT INTO supplier_price_items (id, organization_id, list_id, supplier_id, code, description, unit, price_cents) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    ).bind(crypto.randomUUID(), org, id, supplierId, item.codigo, item.descricao.slice(0, 300), item.unidade, item.custoUnitarioCentavos)),
  ]);
  return { id, itens: lido.itens.length, ignoradas: lido.ignoradas, aba: lido.aba, linhaDoCabecalho: lido.linhaDoCabecalho + 1 };
}
