// Leitura financeira de uma planilha neutra. Nada aqui adivinha: a análise só usa as
// colunas que a pessoa marcou com um papel, e todo número é aritmética sobre os valores
// já calculados da planilha. Quando falta um dado para uma conta, a conta não aparece —
// no lugar dela vai o que precisa ser marcado.

import { evaluateSheet, cellKey, columnName, exact, type SheetCells } from "@/lib/spreadsheet";

export const COLUMN_ROLES = {
  ignorar: { label: "Ignorar", kind: "none" },
  descricao: { label: "Descrição", kind: "text" },
  setor: { label: "Setor / categoria", kind: "text" },
  data: { label: "Data", kind: "text" },
  receita: { label: "Receita (R$)", kind: "money" },
  custo: { label: "Custo (R$)", kind: "money" },
  custo_colaborador: { label: "Custo com colaborador (R$)", kind: "money" },
  horas: { label: "Horas trabalhadas", kind: "number" },
  quantidade: { label: "Quantidade", kind: "number" },
  preco_unitario: { label: "Preço unitário (R$)", kind: "money" },
} as const;

export type ColumnRole = keyof typeof COLUMN_ROLES;

export type AnalysisSettings = {
  headerRow: number;
  roles: Record<string, ColumnRole>;
  targetMarginPercent: number;
};

export const defaultAnalysisSettings: AnalysisSettings = { headerRow: 0, roles: {}, targetMarginPercent: 20 };

export type SectorAnalysis = {
  name: string;
  revenue: number; cost: number; collaboratorCost: number; hours: number;
  margin: number; marginPercent: number | null;
  sharePercent: number | null;
  requiredRevenue: number | null; priceIncreasePercent: number | null; costCutNeeded: number | null;
  revenuePerHour: number | null; costPerHour: number | null;
  status: "perda" | "abaixo" | "saudavel";
  rows: number;
};

export type AnalysisFinding = {
  id: string;
  severity: "perda" | "abaixo" | "saudavel" | "faltando";
  title: string;
  detail: string;
  action: string | null;
};

export type FinanceAnalysis = {
  ready: boolean;
  missing: string[];
  rowsCounted: number;
  targetMarginPercent: number;
  totals: {
    revenue: number; cost: number; collaboratorCost: number; otherCost: number;
    hours: number; margin: number; marginPercent: number | null;
    collaboratorSharePercent: number | null; costSharePercent: number | null;
  };
  perHour: { revenue: number; cost: number; margin: number; required: number | null; increasePercent: number | null } | null;
  overall: { requiredRevenue: number | null; priceIncreasePercent: number | null; costCutNeeded: number | null };
  sectors: SectorAnalysis[];
  findings: AnalysisFinding[];
};

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const percent = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const amount = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

// Sugestão a partir do cabeçalho. É proposta, nunca aplicada sozinha: quem confirma é a
// pessoa, porque um papel errado contaminaria toda a leitura.
export function suggestRoles(cells: SheetCells, columns: number, headerRow: number): Record<string, ColumnRole> {
  const computed = evaluateSheet(cells);
  const suggestions: Record<string, ColumnRole> = {};
  for (let column = 0; column < columns; column += 1) {
    const header = String(computed[cellKey({ column, row: headerRow })]?.display ?? "").trim().toLocaleLowerCase("pt-BR");
    if (!header) continue;
    const normalized = header.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const role: ColumnRole =
      /colaborador|equipe|funcionario|mao de obra|salario|folha|terceiro|prestador/.test(normalized) ? "custo_colaborador"
      // "Centro de custo" é rótulo de setor, não coluna de valor: vem antes de "custo".
      : /setor|categoria|area|servico|centro de|tipo|cliente|projeto|obra/.test(normalized) ? "setor"
      : /receita|faturamento|venda|entrada|recebido|honorario/.test(normalized) ? "receita"
      : /custo|despesa|gasto|saida|material|compra/.test(normalized) ? "custo"
      : /hora/.test(normalized) ? "horas"
      : /data|dia|mes|periodo|competencia/.test(normalized) ? "data"
      : /quantidade|qtd|qtde/.test(normalized) ? "quantidade"
      : /preco|valor unit|unitario/.test(normalized) ? "preco_unitario"
      : /descricao|item|nome|historico/.test(normalized) ? "descricao"
      : "ignorar";
    if (role !== "ignorar") suggestions[columnName(column)] = role;
  }
  return suggestions;
}

function columnsWithRole(roles: Record<string, ColumnRole>, role: ColumnRole) {
  return Object.entries(roles).filter(([, value]) => value === role).map(([letter]) => letter);
}

// O teto de custo para a meta multiplica dois valores que o binário não representa
// exatamente. Sem limpar o intermediário, "cortar R$ 7.000" sairia como 7000,00000000001.
function maxCostFor(revenue: number, targetMarginPercent: number) {
  return exact(revenue * exact(1 - targetMarginPercent / 100));
}

function costCutFor(cost: number, revenue: number, targetMarginPercent: number) {
  return exact(cost - maxCostFor(revenue, targetMarginPercent));
}

function requiredRevenueFor(cost: number, targetMarginPercent: number) {
  const target = targetMarginPercent / 100;
  if (target >= 1 || cost <= 0) return null;
  return exact(cost / (1 - target));
}

export function analyzeSheet(
  cells: SheetCells,
  columns: number,
  rows: number,
  settings: AnalysisSettings,
): FinanceAnalysis {
  const computed = evaluateSheet(cells);
  const roles = settings.roles;
  const target = settings.targetMarginPercent;

  const revenueColumns = columnsWithRole(roles, "receita");
  const costColumns = columnsWithRole(roles, "custo");
  const collaboratorColumns = columnsWithRole(roles, "custo_colaborador");
  const hourColumns = columnsWithRole(roles, "horas");
  const quantityColumns = columnsWithRole(roles, "quantidade");
  const unitPriceColumns = columnsWithRole(roles, "preco_unitario");
  const sectorColumn = columnsWithRole(roles, "setor")[0] ?? null;

  const missing: string[] = [];
  const hasRevenue = revenueColumns.length > 0 || (quantityColumns.length > 0 && unitPriceColumns.length > 0);
  if (!hasRevenue) missing.push("Marque uma coluna como Receita, ou marque Quantidade e Preço unitário para a receita ser calculada.");
  if (!costColumns.length && !collaboratorColumns.length) missing.push("Marque ao menos uma coluna como Custo ou Custo com colaborador.");

  const numberAt = (letter: string, row: number) => {
    const value = computed[`${letter}${row + 1}`]?.value;
    return typeof value === "number" ? value : 0;
  };
  const textAt = (letter: string, row: number) => String(computed[`${letter}${row + 1}`]?.display ?? "").trim();

  type Bucket = { revenue: number; cost: number; collaboratorCost: number; hours: number; rows: number };
  const empty = (): Bucket => ({ revenue: 0, cost: 0, collaboratorCost: 0, hours: 0, rows: 0 });
  const totalsBucket = empty();
  const sectorBuckets = new Map<string, Bucket>();

  for (let row = settings.headerRow + 1; row < rows; row += 1) {
    const direct = revenueColumns.reduce((sum, letter) => sum + numberAt(letter, row), 0);
    const derived = quantityColumns.length && unitPriceColumns.length
      ? quantityColumns.reduce((sum, letter) => sum + numberAt(letter, row), 0)
        * unitPriceColumns.reduce((sum, letter) => sum + numberAt(letter, row), 0)
      : 0;
    const revenue = exact(revenueColumns.length ? direct : derived);
    const cost = exact(costColumns.reduce((sum, letter) => sum + numberAt(letter, row), 0));
    const collaboratorCost = exact(collaboratorColumns.reduce((sum, letter) => sum + numberAt(letter, row), 0));
    const hours = exact(hourColumns.reduce((sum, letter) => sum + numberAt(letter, row), 0));
    if (!revenue && !cost && !collaboratorCost && !hours) continue;

    const name = sectorColumn ? (textAt(sectorColumn, row) || "Sem setor") : "Toda a planilha";
    const bucket = sectorBuckets.get(name) ?? empty();
    for (const target of [bucket, totalsBucket]) {
      target.revenue = exact(target.revenue + revenue);
      target.cost = exact(target.cost + cost);
      target.collaboratorCost = exact(target.collaboratorCost + collaboratorCost);
      target.hours = exact(target.hours + hours);
      target.rows += 1;
    }
    sectorBuckets.set(name, bucket);
  }

  const totalCost = exact(totalsBucket.cost + totalsBucket.collaboratorCost);
  const totalMargin = exact(totalsBucket.revenue - totalCost);
  const marginPercent = totalsBucket.revenue > 0 ? exact((totalMargin / totalsBucket.revenue) * 100) : null;

  const sectors: SectorAnalysis[] = [...sectorBuckets.entries()].map(([name, bucket]) => {
    const cost = exact(bucket.cost + bucket.collaboratorCost);
    const margin = exact(bucket.revenue - cost);
    const sectorMarginPercent = bucket.revenue > 0 ? exact((margin / bucket.revenue) * 100) : null;
    const required = requiredRevenueFor(cost, target);
    return {
      name,
      revenue: bucket.revenue, cost: bucket.cost, collaboratorCost: bucket.collaboratorCost,
      hours: bucket.hours, margin, marginPercent: sectorMarginPercent,
      sharePercent: totalMargin !== 0 ? exact((margin / Math.abs(totalMargin)) * 100) : null,
      requiredRevenue: required,
      priceIncreasePercent: required !== null && bucket.revenue > 0 ? exact((required / bucket.revenue - 1) * 100) : null,
      costCutNeeded: required !== null && bucket.revenue > 0 && required > bucket.revenue
        ? costCutFor(cost, bucket.revenue, target) : null,
      revenuePerHour: bucket.hours > 0 ? exact(bucket.revenue / bucket.hours) : null,
      costPerHour: bucket.hours > 0 ? exact(cost / bucket.hours) : null,
      status: margin < 0 ? "perda" : sectorMarginPercent !== null && sectorMarginPercent < target ? "abaixo" : "saudavel",
      rows: bucket.rows,
    };
  }).sort((left, right) => right.margin - left.margin);

  const perHour = totalsBucket.hours > 0 ? (() => {
    const revenuePerHour = exact(totalsBucket.revenue / totalsBucket.hours);
    const costPerHour = exact(totalCost / totalsBucket.hours);
    const required = requiredRevenueFor(costPerHour, target);
    return {
      revenue: revenuePerHour, cost: costPerHour, margin: exact(revenuePerHour - costPerHour),
      required,
      increasePercent: required !== null && revenuePerHour > 0 ? exact((required / revenuePerHour - 1) * 100) : null,
    };
  })() : null;

  const requiredRevenue = requiredRevenueFor(totalCost, target);
  const findings: AnalysisFinding[] = [];

  for (const item of missing) {
    findings.push({ id: `faltando:${item.slice(0, 20)}`, severity: "faltando", title: "Falta marcar uma coluna", detail: item, action: null });
  }
  if (!hourColumns.length) {
    findings.push({
      id: "faltando:horas", severity: "faltando",
      title: "Margem por hora indisponível",
      detail: "Nenhuma coluna está marcada como Horas trabalhadas, então não dá para calcular quanto a hora rende nem quanto ela custa.",
      action: "Marque a coluna de horas para liberar preço mínimo por hora e margem por hora.",
    });
  }
  if (!sectorColumn && totalsBucket.rows > 0) {
    findings.push({
      id: "faltando:setor", severity: "faltando",
      title: "Comparação por setor indisponível",
      detail: "Sem uma coluna marcada como Setor / categoria, a planilha é lida como um bloco único e não dá para dizer onde ganha e onde perde.",
      action: "Marque a coluna que separa serviço, cliente, obra ou área.",
    });
  }

  const ready = hasRevenue && (costColumns.length > 0 || collaboratorColumns.length > 0) && totalsBucket.rows > 0;

  if (ready) {
    if (totalMargin < 0) {
      findings.push({
        id: "geral:prejuizo", severity: "perda",
        title: "A operação está no prejuízo",
        detail: `A receita somou ${money(totalsBucket.revenue)} e o custo ${money(totalCost)}: faltam ${money(Math.abs(totalMargin))} só para empatar.`,
        action: requiredRevenue !== null
          ? `Para a margem de ${percent(target)}, a receita precisa ser ${money(requiredRevenue)} — ${percent(exact((requiredRevenue / totalsBucket.revenue - 1) * 100))} acima da atual — ou o custo cair ${money(costCutFor(totalCost, totalsBucket.revenue, target))}.`
          : null,
      });
    } else if (marginPercent !== null && marginPercent < target) {
      findings.push({
        id: "geral:abaixo", severity: "abaixo",
        title: `Margem de ${percent(marginPercent)}, abaixo da meta de ${percent(target)}`,
        detail: `Receita ${money(totalsBucket.revenue)}, custo ${money(totalCost)}, sobra ${money(totalMargin)}.`,
        action: requiredRevenue !== null && totalsBucket.revenue > 0
          ? `Aumente o preço em ${percent(exact((requiredRevenue / totalsBucket.revenue - 1) * 100))} (receita de ${money(requiredRevenue)}) ou corte ${money(costCutFor(totalCost, totalsBucket.revenue, target))} de custo.`
          : null,
      });
    } else if (marginPercent !== null) {
      findings.push({
        id: "geral:saudavel", severity: "saudavel",
        title: `Margem de ${percent(marginPercent)}, na meta de ${percent(target)}`,
        detail: `Receita ${money(totalsBucket.revenue)}, custo ${money(totalCost)}, sobra ${money(totalMargin)}. Nenhum aumento de preço é necessário para manter a meta.`,
        action: null,
      });
    }

    if (perHour) {
      findings.push({
        id: "hora:preco", severity: perHour.margin < 0 ? "perda" : perHour.increasePercent !== null && perHour.increasePercent > 0 ? "abaixo" : "saudavel",
        title: `A hora rende ${money(perHour.revenue)} e custa ${money(perHour.cost)}`,
        detail: `${amount(totalsBucket.hours)} h trabalhadas deixam ${money(perHour.margin)} por hora.`,
        action: perHour.required !== null && perHour.increasePercent !== null && perHour.increasePercent > 0
          ? `Para a meta de ${percent(target)}, a hora precisa ser cobrada a ${money(perHour.required)} — ${percent(perHour.increasePercent)} acima do que é cobrado hoje.`
          : perHour.required !== null
            ? `O preço atual já cobre a meta: o mínimo por hora seria ${money(perHour.required)}.`
            : null,
      });
    }

    if (collaboratorColumns.length && totalsBucket.revenue > 0) {
      const share = exact((totalsBucket.collaboratorCost / totalsBucket.revenue) * 100);
      const ceiling = exact(100 - target);
      const otherShare = exact((totalsBucket.cost / totalsBucket.revenue) * 100);
      findings.push({
        id: "colaborador:peso",
        severity: share + otherShare > ceiling ? "abaixo" : "saudavel",
        title: `Colaboradores consomem ${percent(share)} da receita`,
        detail: `${money(totalsBucket.collaboratorCost)} de colaboradores e ${money(totalsBucket.cost)} de outros custos, sobre ${money(totalsBucket.revenue)} de receita.`,
        action: share + otherShare > ceiling
          ? `Para a meta de ${percent(target)}, todos os custos juntos não podem passar de ${percent(ceiling)} da receita. Hoje somam ${percent(exact(share + otherShare))}: são ${money(costCutFor(totalCost, totalsBucket.revenue, target))} acima do teto.`
          : `Os custos somam ${percent(exact(share + otherShare))} da receita, dentro do teto de ${percent(ceiling)} para a meta.`,
      });
    }

    for (const sector of sectors.filter((item) => item.status !== "saudavel").slice(0, 8)) {
      const base = `${money(sector.revenue)} de receita contra ${money(exact(sector.cost + sector.collaboratorCost))} de custo em ${sector.rows} lançamento(s)`;
      findings.push({
        id: `setor:${sector.name}`,
        severity: sector.status,
        title: sector.status === "perda" ? `${sector.name} dá prejuízo` : `${sector.name} está abaixo da meta`,
        detail: sector.marginPercent !== null
          ? `${base}: margem de ${percent(sector.marginPercent)}.`
          : `${base}. Sem receita lançada, não há margem a calcular.`,
        action: sector.priceIncreasePercent !== null
          ? `Alinhe o preço deste setor: subir ${percent(sector.priceIncreasePercent)} leva a receita para ${money(sector.requiredRevenue ?? 0)}${sector.costCutNeeded && sector.costCutNeeded > 0 ? `, ou corte ${money(sector.costCutNeeded)} de custo` : ""}.`
          : sector.requiredRevenue !== null
            ? `Este setor não tem receita lançada. Para cobrir o custo com a meta, ele precisaria faturar ${money(sector.requiredRevenue)}.`
            : null,
      });
    }

    const healthy = sectors.filter((item) => item.status === "saudavel");
    if (healthy.length && sectorColumn) {
      const best = healthy[0];
      findings.push({
        id: `setor:melhor:${best.name}`, severity: "saudavel",
        title: `${best.name} é onde você mais ganha`,
        detail: `${money(best.margin)} de sobra${best.marginPercent !== null ? ` e margem de ${percent(best.marginPercent)}` : ""}${best.sharePercent !== null ? `, ${percent(best.sharePercent)} de toda a margem da planilha` : ""}.`,
        action: best.revenuePerHour !== null ? `A hora deste setor rende ${money(best.revenuePerHour)} e custa ${money(best.costPerHour ?? 0)}.` : null,
      });
    }
  }

  return {
    ready,
    missing,
    rowsCounted: totalsBucket.rows,
    targetMarginPercent: target,
    totals: {
      revenue: totalsBucket.revenue, cost: totalCost, collaboratorCost: totalsBucket.collaboratorCost,
      otherCost: totalsBucket.cost, hours: totalsBucket.hours, margin: totalMargin, marginPercent,
      collaboratorSharePercent: totalsBucket.revenue > 0 ? exact((totalsBucket.collaboratorCost / totalsBucket.revenue) * 100) : null,
      costSharePercent: totalsBucket.revenue > 0 ? exact((totalCost / totalsBucket.revenue) * 100) : null,
    },
    perHour,
    overall: {
      requiredRevenue,
      priceIncreasePercent: requiredRevenue !== null && totalsBucket.revenue > 0 ? exact((requiredRevenue / totalsBucket.revenue - 1) * 100) : null,
      costCutNeeded: totalsBucket.revenue > 0 ? costCutFor(totalCost, totalsBucket.revenue, target) : null,
    },
    sectors,
    findings,
  };
}
