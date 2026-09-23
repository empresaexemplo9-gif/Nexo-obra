import { z } from "zod";
import { cellKey, parseCellKey, parseNumber, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, type SheetResult } from "@/lib/spreadsheet";

export function rangeCells(range: string) {
  if (!/^[A-Z]{1,2}[1-9]\d{0,2}(:[A-Z]{1,2}[1-9]\d{0,2})?$/.test(range)) throw new Error("Use um intervalo como A2:B50.");
  const [from, to = from] = range.split(":");
  const a = parseCellKey(from)!, b = parseCellKey(to)!;
  if (a.column > b.column || a.row > b.row || b.column >= 52 || b.row >= 500) throw new Error("Intervalo inválido. Limite: A1:AZ500.");
  const keys: string[] = [];
  for (let row = a.row; row <= b.row; row++) for (let column = a.column; column <= b.column; column++) keys.push(cellKey({ row, column }));
  return { a, b, keys };
}
const rangeSchema = z.string().max(13).refine(value => { try { rangeCells(value); return true; } catch { return false; } }, "Intervalo inválido.");
export const validationRuleSchema = z.object({
  range: rangeSchema, kind: z.enum(["list", "number", "date", "required"]),
  options: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  min: z.number().finite().optional(), max: z.number().finite().optional(), allowBlank: z.boolean().default(true),
}).strict().refine(rule => rule.kind !== "list" || rule.options.length > 0, "Informe as opções da lista.")
  .refine(rule => rule.min === undefined || rule.max === undefined || rule.min <= rule.max, "Mínimo maior que máximo.");
export const conditionalRuleSchema = z.object({
  range: rangeSchema, kind: z.enum(["greater", "less", "equal", "contains", "blank"]),
  value: z.string().max(200).default(""), color: z.enum(["green", "red", "yellow", "blue"]),
}).strict().refine(rule => !["greater", "less"].includes(rule.kind) || parseNumber(rule.value) !== null, "Informe um número válido.");
export const summaryViewSchema = z.object({
  name: z.string().trim().min(1).max(80), range: rangeSchema,
  groupColumn: z.number().int().min(0).max(51), valueColumn: z.number().int().min(0).max(51),
  aggregation: z.enum(["sum", "count", "average", "min", "max"]), chart: z.enum(["bar", "line", "table"]),
}).strict().refine(view => { const { a, b } = rangeCells(view.range); return view.groupColumn >= a.column && view.groupColumn <= b.column && view.valueColumn >= a.column && view.valueColumn <= b.column && a.row < b.row; }, "As colunas devem estar no intervalo, com cabeçalho e pelo menos uma linha de dados.");
export const advancedSchema = z.object({
  validations: z.array(validationRuleSchema).max(20).default([]),
  conditions: z.array(conditionalRuleSchema).max(20).default([]),
  views: z.array(summaryViewSchema).max(10).default([]),
}).strict();
export type AdvancedSettings = z.infer<typeof advancedSchema>;
export type SummaryView = z.infer<typeof summaryViewSchema>;
export const emptyAdvanced: AdvancedSettings = { validations: [], conditions: [], views: [] };
export const ruleColors = { green: "#dcfce7", red: "#fee2e2", yellow: "#fef9c3", blue: "#dbeafe" };

/** DD/MM/AAAA, como se digita no Brasil e como HOJE() escreve, ou AAAA-MM-DD. */
export function dataValida(text: string) {
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  const [year, month, day] = br ? [Number(br[3]), Number(br[2]), Number(br[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [NaN, NaN, NaN];
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validationIssues(computed: SheetResult, settings: AdvancedSettings) {
  const issues = new Map<string, string>();
  for (const rule of settings.validations) for (const key of rangeCells(rule.range).keys) {
    const cell = computed[key], value = cell?.value, blank = value === null || value === undefined || value === "";
    if (blank && rule.allowBlank && rule.kind !== "required") continue;
    let valid = !cell?.error && !blank;
    if (valid && rule.kind === "list") valid = rule.options.includes(String(value));
    if (valid && rule.kind === "number") valid = typeof value === "number" && (rule.min === undefined || value >= rule.min) && (rule.max === undefined || value <= rule.max);
    if (valid && rule.kind === "date") valid = dataValida(String(value));
    if (!valid) issues.set(key, rule.kind === "list" ? "Escolha um valor da lista." : rule.kind === "date" ? "Use uma data válida, como 23/09/2026." : rule.kind === "number" ? "Número fora da regra de validação." : "Preenchimento obrigatório.");
  }
  return issues;
}

export function conditionalColors(computed: SheetResult, settings: AdvancedSettings) {
  const colors: Record<string, string> = {};
  for (const rule of settings.conditions) for (const key of rangeCells(rule.range).keys) {
    const cell = computed[key];
    if (cell?.error) continue;
    // O valor da regra é lido como a célula: "1.500,5" é o número 1500,5. Comparar o texto
    // cru fazia "igual a 1500,5" nunca casar com a célula que vale 1500,5.
    const value = cell?.value ?? "", target = parseNumber(rule.value);
    const texto = (item: unknown) => String(item).trim().toLocaleLowerCase("pt-BR");
    const match = rule.kind === "blank" ? value === "" : rule.kind === "contains" ? texto(value).includes(texto(rule.value))
      : rule.kind === "equal" ? (typeof value === "number" && target !== null ? value === target : texto(value) === texto(rule.value))
      : typeof value === "number" && target !== null && (rule.kind === "greater" ? value > target : value < target);
    if (match) colors[key] = ruleColors[rule.color];
  }
  return colors;
}

export function summarize(computed: SheetResult, view: SummaryView) {
  const { a, b } = rangeCells(view.range);
  const groups = new Map<string, number[]>();
  let ignored = 0;
  for (let row = a.row + 1; row <= b.row; row++) {
    const group = computed[cellKey({ row, column: view.groupColumn })];
    const cell = computed[cellKey({ row, column: view.valueColumn })];
    if ((!group || group.value === "" || group.value === null) && (!cell || cell.value === "" || cell.value === null)) continue;
    if (group?.error || cell?.error) throw new Error(`Corrija os erros de fórmula na linha ${row + 1} antes de gerar o resumo.`);
    if (view.aggregation !== "count" && typeof cell?.value !== "number") { ignored++; continue; }
    const label = String(group?.value ?? "(vazio)");
    const values = groups.get(label) ?? [];
    values.push(view.aggregation === "count" ? 1 : cell!.value as number); groups.set(label, values);
  }
  const rows = [...groups].map(([label, values]) => {
    const sum = values.reduce((total, value) => total + value, 0);
    const value = view.aggregation === "count" ? values.length : view.aggregation === "average" ? sum / values.length : view.aggregation === "min" ? Math.min(...values) : view.aggregation === "max" ? Math.max(...values) : sum;
    if (!Number.isFinite(value)) throw new Error("O resumo excedeu o limite numérico.");
    return { label, value: Number(value.toPrecision(15)) };
  });
  return { rows, ignored };
}

export function moveAdvanced(settings: AdvancedSettings, axis: "row" | "column", index: number, delta: number): AdvancedSettings {
  function moveRange(range: string) {
    const { a, b } = rangeCells(range);
    if (delta < 0 && a[axis] === index && b[axis] === index) return null;
    a[axis] = a[axis] < index ? a[axis] : Math.max(index, a[axis] + delta);
    b[axis] = b[axis] < index ? b[axis] : b[axis] + delta;
    // Uma regra como A2:A500 cobre a coluna inteira. Lançar erro aqui cancelava a inserção
    // da linha inteira; o certo é a regra parar no limite da planilha.
    const limite = axis === "row" ? SHEET_MAX_ROWS : SHEET_MAX_COLUMNS;
    if (a[axis] >= limite) return null;
    b[axis] = Math.min(b[axis], limite - 1);
    return `${cellKey(a)}:${cellKey(b)}`;
  }
  return {
    validations: settings.validations.flatMap(rule => { const range = moveRange(rule.range); return range ? [{ ...rule, range }] : []; }),
    conditions: settings.conditions.flatMap(rule => { const range = moveRange(rule.range); return range ? [{ ...rule, range }] : []; }),
    views: settings.views.flatMap(view => {
      const range = moveRange(view.range);
      if (!range || (axis === "column" && delta < 0 && [view.groupColumn, view.valueColumn].includes(index))) return [];
      const move = (column: number) => axis === "column" && column >= index ? column + delta : column;
      const next = { ...view, range, groupColumn: move(view.groupColumn), valueColumn: move(view.valueColumn) };
      return summaryViewSchema.safeParse(next).success ? [next] : [];
    }),
  };
}
