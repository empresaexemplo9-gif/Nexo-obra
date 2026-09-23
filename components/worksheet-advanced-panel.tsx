"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { columnName, type SheetResult } from "@/lib/spreadsheet";
import { advancedSchema, summarize, validationIssues, type AdvancedSettings, type SummaryView } from "@/lib/worksheet-advanced";

const aggregations = { sum: "Soma", count: "Contagem de linhas", average: "Média", min: "Mínimo", max: "Máximo" };

function Summary({ computed, view, onTable }: { computed: SheetResult; view: SummaryView; onTable?: (table: string[][]) => void }) {
  let result;
  try { result = summarize(computed, view); } catch (cause) { return <p role="alert">{cause instanceof Error ? cause.message : "Resumo indisponível."}</p>; }
  const { rows, ignored } = result;
  const max = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  const chartRows = rows.slice(0, 40);
  return <div className="space-y-2">
    <p className="text-xs">{view.range} · {aggregations[view.aggregation]} · {rows.length} grupo(s). {ignored > 0 && `${ignored} linha(s) sem valor numérico ignoradas.`}</p>
    {view.chart !== "table" && rows.length > 0 && <div className="overflow-x-auto"><svg role="img" aria-label={`${view.name}: valores por grupo. Dados completos na tabela abaixo.`} viewBox={`0 0 640 ${view.chart === "bar" ? chartRows.length * 28 + 24 : 260}`} className="w-full min-w-[520px] max-w-3xl rounded border bg-white">
      {view.chart === "bar" ? chartRows.map((row, index) => <g key={index}>
        <title>{row.label}: {row.value}</title><text x="8" y={index * 28 + 20} fontSize="12">{row.label.slice(0, 20)}</text>
        <line x1="390" x2="390" y1={index * 28 + 4} y2={index * 28 + 27} stroke="#64748b" />
        <rect x={row.value < 0 ? 390 - Math.abs(row.value) / max * 205 : 390} y={index * 28 + 6} width={Math.abs(row.value) / max * 205} height="18" fill={row.value < 0 ? "#b91c1c" : "#15803d"} />
      </g>) : <>
        <line x1="30" x2="610" y1="125" y2="125" stroke="#64748b" />
        <polyline fill="none" stroke="#15803d" strokeWidth="3" points={chartRows.map((row, index) => `${30 + index / Math.max(1, chartRows.length - 1) * 580},${125 - row.value / max * 100}`).join(" ")} />
        {chartRows.map((row, index) => <circle key={index} cx={30 + index / Math.max(1, chartRows.length - 1) * 580} cy={125 - row.value / max * 100} r="4" fill="#15803d"><title>{row.label}: {row.value}</title></circle>)}
        <text x="30" y="245" fontSize="12">Grupos na mesma ordem da tabela · eixo central: zero</text>
      </>}
    </svg></div>}
    {rows.length > 40 && view.chart !== "table" && <p className="text-xs">Gráfico: primeiros 40 grupos. A tabela e a cópia incluem todos.</p>}
    <div className="max-h-64 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{view.name}</caption><thead><tr><th>Grupo</th><th>{aggregations[view.aggregation]}</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td className="break-all">{row.label}</td><td>{row.value.toLocaleString("pt-BR", { maximumFractionDigits: 10 })}</td></tr>)}</tbody></table></div>
    {!rows.length && <p>Nenhum dado para resumir neste intervalo.</p>}
    {onTable && <Button variant="outline" size="sm" className="h-auto max-w-full whitespace-normal py-2" disabled={!rows.length} onClick={() => onTable([["Grupo", aggregations[view.aggregation]], ...rows.map(row => ["'" + row.label, String(row.value).replace(".", ",")])])}>Inserir valores do resumo na seleção</Button>}
  </div>;
}

export function WorksheetAdvancedPanel({ computed, settings, columns, selectedRange, readOnly, onChange, onTable }: {
  computed: SheetResult; settings: AdvancedSettings; columns: number; selectedRange: string; readOnly: boolean;
  onChange: (settings: AdvancedSettings) => void; onTable: (table: string[][]) => void;
}) {
  const [range, setRange] = useState("");
  const [kind, setKind] = useState("list"), [options, setOptions] = useState(""), [min, setMin] = useState(""), [max, setMax] = useState(""), [allowBlank, setAllowBlank] = useState(true);
  const [condition, setCondition] = useState("greater"), [value, setValue] = useState(""), [color, setColor] = useState("green");
  const [name, setName] = useState(""), [groupColumn, setGroupColumn] = useState(0), [valueColumn, setValueColumn] = useState(Math.min(1, columns - 1)), [aggregation, setAggregation] = useState("sum"), [chart, setChart] = useState("bar");
  const actualRange = range || selectedRange;
  const issues = validationIssues(computed, settings);
  function apply(candidate: unknown) {
    const result = advancedSchema.safeParse(candidate);
    if (!result.success) { toast.error(result.error.issues[0]?.message ?? "Confira os campos."); return; }
    onChange(result.data);
  }
  const numeric = (text: string) => text.trim() === "" ? undefined : Number(text.replace(",", "."));
  return <details className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Validação, cores, gráficos e tabelas dinâmicas</summary>
    <div className="mt-3 space-y-4">
      <p className="text-xs">As regras e os resumos acompanham as alterações dos dados. Salve para guardar a configuração. Datas aceitam DD/MM/AAAA.</p>
      {issues.size > 0 && <div role="alert" className="rounded border border-red-300 p-2"><p>{issues.size} célula(s) inválida(s). Corrija os valores ou as regras antes de salvar.</p><ul>{[...issues].slice(0, 15).map(([key, message]) => <li key={key}>{key}: {message}</li>)}</ul>{issues.size > 15 && <p>Exibindo as primeiras 15.</p>}</div>}
      {!readOnly && <>
        <label className="block">Intervalo das novas regras e resumos<Input aria-label="Intervalo avançado" value={actualRange} onChange={event => setRange(event.target.value.toUpperCase())} placeholder="A1:B50" className="mt-1 max-w-xs" /></label>
        <fieldset className="space-y-2 rounded border p-3"><legend>Validação de dados</legend>
          <div className="flex flex-wrap gap-2"><NativeSelect aria-label="Tipo de validação" value={kind} onChange={event => setKind(event.target.value)}><option value="list">Lista de opções</option><option value="number">Número entre limites</option><option value="date">Data</option><option value="required">Obrigatório</option></NativeSelect>
            {kind === "list" && <Input aria-label="Opções permitidas" placeholder="Opções separadas por ;" value={options} onChange={event => setOptions(event.target.value)} className="max-w-sm" />}
            {kind === "number" && <><Input aria-label="Valor mínimo" placeholder="Mínimo (opcional)" value={min} onChange={event => setMin(event.target.value)} className="max-w-48" /><Input aria-label="Valor máximo" placeholder="Máximo (opcional)" value={max} onChange={event => setMax(event.target.value)} className="max-w-48" /></>}
            {kind !== "required" && <label className="flex items-center gap-2"><input type="checkbox" checked={allowBlank} onChange={event => setAllowBlank(event.target.checked)} />Permitir vazio</label>}
            <Button size="sm" variant="outline" disabled={settings.validations.length >= 20} onClick={() => apply({ ...settings, validations: [...settings.validations, { range: actualRange, kind, options: kind === "list" ? options.split(";").map(item => item.trim()).filter(Boolean) : [], min: kind === "number" ? numeric(min) : undefined, max: kind === "number" ? numeric(max) : undefined, allowBlank }] })}>Adicionar validação</Button>
          </div>
        </fieldset>
        <fieldset className="space-y-2 rounded border p-3"><legend>Formatação condicional</legend><div className="flex flex-wrap gap-2">
          <NativeSelect aria-label="Condição" value={condition} onChange={event => setCondition(event.target.value)}><option value="greater">Maior que</option><option value="less">Menor que</option><option value="equal">Igual a</option><option value="contains">Texto contém</option><option value="blank">Vazio</option></NativeSelect>
          {condition !== "blank" && <Input aria-label="Valor da condição" value={value} onChange={event => setValue(event.target.value)} className="max-w-xs" />}
          <NativeSelect aria-label="Cor da condição" value={color} onChange={event => setColor(event.target.value)}><option value="green">Verde</option><option value="red">Vermelho</option><option value="yellow">Amarelo</option><option value="blue">Azul</option></NativeSelect>
          <Button size="sm" variant="outline" disabled={settings.conditions.length >= 20} onClick={() => apply({ ...settings, conditions: [...settings.conditions, { range: actualRange, kind: condition, value, color }] })}>Adicionar cor</Button>
        </div><p className="text-xs">Se várias regras coincidirem, a última define a cor.</p></fieldset>
        <fieldset className="space-y-2 rounded border p-3"><legend>Tabela dinâmica e gráfico</legend>
          <p className="text-xs">A primeira linha do intervalo é o cabeçalho. Agrupe uma coluna e agregue outra. Contagem inclui linhas com dados; as outras operações ignoram valores não numéricos.</p>
          <div className="flex flex-wrap gap-2"><Input aria-label="Nome do resumo" value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: custo por setor" maxLength={80} className="max-w-xs" />
            <label>Agrupar por<NativeSelect aria-label="Coluna de agrupamento" value={groupColumn} onChange={event => setGroupColumn(Number(event.target.value))}>{Array.from({ length: columns }, (_, index) => <option key={index} value={index}>{columnName(index)}</option>)}</NativeSelect></label>
            <label>Valores<NativeSelect aria-label="Coluna de valores" value={valueColumn} onChange={event => setValueColumn(Number(event.target.value))}>{Array.from({ length: columns }, (_, index) => <option key={index} value={index}>{columnName(index)}</option>)}</NativeSelect></label>
            <NativeSelect aria-label="Agregação" value={aggregation} onChange={event => setAggregation(event.target.value)}>{Object.entries(aggregations).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect>
            <NativeSelect aria-label="Visualização do resumo" value={chart} onChange={event => setChart(event.target.value)}><option value="bar">Barras</option><option value="line">Linhas</option><option value="table">Somente tabela</option></NativeSelect>
            <Button size="sm" variant="outline" disabled={settings.views.length >= 10} onClick={() => apply({ ...settings, views: [...settings.views, { name, range: actualRange, groupColumn, valueColumn, aggregation, chart }] })}>Criar resumo</Button>
          </div>
        </fieldset>
      </>}
      {settings.validations.map((rule, index) => <div key={index} className="flex flex-wrap items-center gap-2"><span>{rule.range} · {({ list: "Lista", number: "Número", date: "Data", required: "Obrigatório" })[rule.kind]} {rule.options.join("; ")}{rule.kind === "number" && ` (${rule.min ?? "sem mínimo"} a ${rule.max ?? "sem máximo"})`}</span>{!readOnly && <Button size="sm" variant="ghost" aria-label={`Excluir validação ${index + 1}`} onClick={() => apply({ ...settings, validations: settings.validations.filter((_, i) => i !== index) })}>Excluir regra</Button>}</div>)}
      {settings.conditions.map((rule, index) => <div key={index} className="flex flex-wrap items-center gap-2"><span>{rule.range} · {({ greater: "Maior que", less: "Menor que", equal: "Igual a", contains: "Contém", blank: "Vazio" })[rule.kind]} {rule.value} · {({ green: "Verde", red: "Vermelho", yellow: "Amarelo", blue: "Azul" })[rule.color]}</span>{!readOnly && <Button size="sm" variant="ghost" aria-label={`Excluir cor ${index + 1}`} onClick={() => apply({ ...settings, conditions: settings.conditions.filter((_, i) => i !== index) })}>Excluir cor</Button>}</div>)}
      {settings.views.map((view, index) => <section key={index} className="space-y-2 rounded border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{view.name}</h3>{!readOnly && <Button size="sm" variant="ghost" aria-label={`Excluir resumo ${view.name}`} onClick={() => apply({ ...settings, views: settings.views.filter((_, i) => i !== index) })}>Excluir resumo</Button>}</div><Summary computed={computed} view={view} onTable={readOnly ? undefined : onTable} /></section>)}
    </div>
  </details>;
}
