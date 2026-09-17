import { normalizeReferenceMonth, normalizeSinapiUf, regimeSchema, type SinapiRegime } from "./sinapi-contract";
import { isOrcamentadorConfigured, searchOrcamentadorItems } from "./orcamentador";

// Contrato de compatibilidade: SINAPI_API_TOKEN continua sendo a credencial server-side.
// O adaptador genérico anterior usava Authorization; o Orçamentador usa X-API-Key conforme o SDK oficial.

export type SinapiItem = {
  code: string;
  description: string;
  unit: string;
  unitCostCents: number;
  referenceMonth: string;
  state: string;
  regime: SinapiRegime;
  sourceReference: string;
};

export function isSinapiConfigured() {
  return isOrcamentadorConfigured();
}

export async function searchSinapiItems(query: string, state: string, referenceMonth: string, regime = "NaoDesonerado"): Promise<SinapiItem[]> {
  const typedRegime = regimeSchema.parse(regime);
  const normalizedState = normalizeSinapiUf(state);
  const normalizedMonth = normalizeReferenceMonth(referenceMonth);
  const items = await searchOrcamentadorItems(query, normalizedState, normalizedMonth, typedRegime);
  return items.map((item) => ({
    code: item.codigo,
    description: item.descricao,
    unit: item.unidade,
    unitCostCents: item.custoUnitarioCentavos,
    referenceMonth: normalizedMonth,
    state: normalizedState,
    regime: typedRegime,
    sourceReference: `ORCAMENTADOR:SINAPI:${normalizedState}:${normalizedMonth}:${typedRegime}:${item.tipo}:${item.codigo}`,
  }));
}
