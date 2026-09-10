"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, ShieldCheck, TrendingDown, TrendingUp, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { analyzeSheet, COLUMN_ROLES, suggestRoles, type AnalysisSettings, type ColumnRole } from "@/lib/finance-analysis";
import { cellKey, columnName, evaluateSheet, type SheetCells } from "@/lib/spreadsheet";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const percent = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const severityStyles: Record<string, string> = {
  perda: "border-hoikos-400 bg-hoikos-50",
  abaixo: "border-hoikos-300 bg-hoikos-50",
  saudavel: "border-hoikos-200 bg-white",
  faltando: "border-dashed border-hoikos-300 bg-white",
};
const severityLabels: Record<string, string> = {
  perda: "Perde dinheiro", abaixo: "Abaixo da meta", saudavel: "Saudável", faltando: "Falta dado",
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-md border border-hoikos-100 p-3">
    <p className="text-xs text-hoikos-500">{label}</p>
    <p className="metric-number mt-1 text-xl font-semibold tabular-nums text-hoikos-950">{value}</p>
    {hint ? <p className="mt-0.5 text-xs text-hoikos-500">{hint}</p> : null}
  </div>;
}

// A planilha é neutra até existir dado. A partir daí, os papéis das colunas dão sentido a
// ele — e é só isso que a leitura usa. Nada é deduzido de valor, só do que foi marcado.
export function AnalysisPanel({
  cells, columns, rows, settings, canEdit, onChange,
}: {
  cells: SheetCells; columns: number; rows: number; settings: AnalysisSettings;
  canEdit: boolean; onChange: (settings: AnalysisSettings) => void;
}) {
  const computed = useMemo(() => evaluateSheet(cells), [cells]);
  const analysis = useMemo(() => analyzeSheet(cells, columns, rows, settings), [cells, columns, rows, settings]);
  const suggestions = useMemo(() => suggestRoles(cells, columns, settings.headerRow), [cells, columns, settings.headerRow]);

  const hasData = Object.keys(cells).length > 0;
  const unmarked = Object.entries(suggestions).filter(([letter]) => !settings.roles[letter]);
  const headers = Array.from({ length: columns }, (_, column) => ({
    letter: columnName(column),
    header: String(computed[cellKey({ column, row: settings.headerRow })]?.display ?? "").trim(),
  }));

  function setRole(letter: string, role: ColumnRole) {
    const roles = { ...settings.roles };
    if (role === "ignorar") delete roles[letter]; else roles[letter] = role;
    onChange({ ...settings, roles });
  }

  if (!hasData) {
    return <Card><CardContent className="p-6 text-center">
      <Info className="mx-auto size-6 text-hoikos-500" />
      <p className="mt-3 font-medium text-hoikos-900">A planilha ainda está vazia</p>
      <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-hoikos-500">
        Digite ou traga os dados reais da empresa. Assim que houver conteúdo, esta aba propõe o papel de cada
        coluna e passa a calcular margem, preço por hora e onde a operação ganha ou perde.
      </p>
    </CardContent></Card>;
  }

  return <div className="space-y-4">
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="text-base">O que é cada coluna</CardTitle>
        <p className="text-sm leading-6 text-hoikos-500">
          A leitura só usa o que estiver marcado aqui. Nenhum papel é aplicado sozinho: uma coluna marcada
          errado mudaria todos os números, então a confirmação é sua.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && unmarked.length ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-hoikos-200 bg-hoikos-50 p-3">
            <Wand2 className="size-4 text-hoikos-600" />
            <p className="flex-1 text-sm text-hoikos-800">
              Pelo cabeçalho, {unmarked.length} coluna(s) parecem ser: {unmarked.map(([letter, role]) => `${letter} = ${COLUMN_ROLES[role].label}`).join(", ")}.
            </p>
            <Button size="sm" onClick={() => onChange({ ...settings, roles: { ...suggestions, ...settings.roles } })}>Aplicar sugestão</Button>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {headers.map(({ letter, header }) => (
            <label key={letter} className="flex items-center gap-2 text-sm">
              <span className="w-10 shrink-0 rounded border border-hoikos-200 bg-hoikos-50 px-1 py-0.5 text-center font-mono text-xs">{letter}</span>
              <span className="min-w-0 flex-1 truncate text-hoikos-600" title={header}>{header || "sem cabeçalho"}</span>
              <NativeSelect
                aria-label={`Papel da coluna ${letter}`} disabled={!canEdit}
                value={settings.roles[letter] ?? "ignorar"}
                onChange={(event) => setRole(letter, event.target.value as ColumnRole)}
                className="h-9 w-44"
              >
                {Object.entries(COLUMN_ROLES).map(([id, role]) => <option key={id} value={id}>{role.label}</option>)}
              </NativeSelect>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <label className="text-sm">Linha do cabeçalho
            <Input type="number" min={1} max={50} disabled={!canEdit} value={settings.headerRow + 1}
              onChange={(event) => onChange({ ...settings, headerRow: Math.max(0, Number(event.target.value) - 1) })}
              className="mt-1 h-9 w-24" />
          </label>
          <label className="text-sm">Margem que você quer (%)
            <Input type="number" min={0} max={95} step={1} disabled={!canEdit} value={settings.targetMarginPercent}
              onChange={(event) => onChange({ ...settings, targetMarginPercent: Math.min(95, Math.max(0, Number(event.target.value))) })}
              className="mt-1 h-9 w-28" />
          </label>
          <p className="text-sm text-hoikos-500">{analysis.rowsCounted} linha(s) com valor entram na conta.</p>
        </div>
      </CardContent>
    </Card>

    {analysis.ready ? <>
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-base">Onde a operação está</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Receita" value={money(analysis.totals.revenue)} />
          <Metric label="Custo total" value={money(analysis.totals.cost)}
            hint={analysis.totals.collaboratorCost ? `${money(analysis.totals.collaboratorCost)} de colaboradores` : undefined} />
          <Metric label="Sobra" value={money(analysis.totals.margin)}
            hint={analysis.totals.marginPercent !== null ? `margem de ${percent(analysis.totals.marginPercent)}` : undefined} />
          {analysis.perHour
            ? <Metric label="Por hora" value={money(analysis.perHour.margin)}
                hint={`rende ${money(analysis.perHour.revenue)} e custa ${money(analysis.perHour.cost)} em ${number(analysis.totals.hours)} h`} />
            : <Metric label="Por hora" value="—" hint="marque a coluna de horas" />}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {analysis.findings.map((finding) => (
          <Card key={finding.id} className={`border ${severityStyles[finding.severity]}`}>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
              <Badge variant="outline" className="w-fit shrink-0">{severityLabels[finding.severity]}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-hoikos-900">{finding.title}</p>
                <p className="mt-1 text-sm leading-6 text-hoikos-600">{finding.detail}</p>
                {finding.action ? <p className="mt-2 text-sm font-medium leading-6 text-hoikos-800">→ {finding.action}</p> : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {analysis.sectors.length > 1 ? <Card className="overflow-hidden">
        <CardHeader className="border-b py-3"><CardTitle className="text-base">Onde ganha e onde perde</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="bg-hoikos-50">
              <TableHead className="pl-5">Setor</TableHead><TableHead className="text-right">Receita</TableHead>
              <TableHead className="text-right">Custo</TableHead><TableHead className="text-right">Sobra</TableHead>
              <TableHead className="text-right">Margem</TableHead><TableHead className="pr-5 text-right">Preço a ajustar</TableHead>
            </TableRow></TableHeader>
            <TableBody>{analysis.sectors.map((sector) => (
              <TableRow key={sector.name}>
                <TableCell className="pl-5">
                  <span className="flex items-center gap-2 font-medium text-hoikos-900">
                    {sector.margin >= 0 ? <TrendingUp className="size-4 text-hoikos-600" /> : <TrendingDown className="size-4 text-hoikos-700" />}
                    {sector.name}
                  </span>
                  <span className="text-xs text-hoikos-500">{sector.rows} lançamento(s){sector.hours ? ` · ${number(sector.hours)} h` : ""}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(sector.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(sector.cost + sector.collaboratorCost)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(sector.margin)}</TableCell>
                <TableCell className="text-right tabular-nums">{sector.marginPercent !== null ? percent(sector.marginPercent) : "—"}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {sector.status === "saudavel" ? <span className="text-hoikos-500">na meta</span>
                    : sector.priceIncreasePercent !== null ? `+${percent(sector.priceIncreasePercent)}` : "—"}
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      </Card> : null}
    </> : (
      <Card><CardContent className="space-y-2 p-5">
        <p className="font-medium text-hoikos-900">A leitura ainda não pode ser feita</p>
        <ul className="list-inside list-disc space-y-1 text-sm leading-6 text-hoikos-600">
          {analysis.missing.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="text-sm text-hoikos-500">Enquanto faltar dado, nenhum número é estimado.</p>
      </CardContent></Card>
    )}
  </div>;
}

// Quadro de liberações. Só o superadministrador chega até aqui.
export function GrantsPanel({ worksheetId }: { worksheetId: string }) {
  const [members, setMembers] = useState<Array<{ id: string; name: string; email: string; role: string; level: string }> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/worksheets/${worksheetId}/grants`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar.");
      setMembers(body.members);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar."); }
  }, [worksheetId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function change(memberId: string, level: string) {
    setBusy(memberId);
    try {
      const response = await fetch(`/api/worksheets/${worksheetId}/grants`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, level }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Não foi possível salvar.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(""); }
  }

  return <Card>
    <CardHeader className="gap-2">
      <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-hoikos-600" />Quem pode abrir esta planilha</CardTitle>
      <p className="text-sm leading-6 text-hoikos-500">
        Esta planilha é fechada por padrão. Quem não estiver liberado aqui não a vê na lista nem consegue abri-la.
      </p>
    </CardHeader>
    <CardContent className="space-y-2">
      {error ? <p role="alert" className="text-sm text-hoikos-700">{error}</p> : null}
      {members?.length ? members.map((member) => (
        <div key={member.id} className="flex flex-wrap items-center gap-3 rounded-md border border-hoikos-100 p-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-hoikos-900">{member.name}</p>
            <p className="truncate text-xs text-hoikos-500">{member.email}</p>
          </div>
          <NativeSelect aria-label={`Acesso de ${member.name}`} value={member.level} disabled={busy === member.id}
            onChange={(event) => void change(member.id, event.target.value)} className="h-9 w-52">
            <option value="none">Sem acesso</option>
            <option value="view">Somente ver</option>
            <option value="edit">Ver e editar</option>
          </NativeSelect>
        </div>
      )) : <p className="py-4 text-sm text-hoikos-500">{members ? "Nenhuma pessoa cadastrada nesta empresa." : "Carregando…"}</p>}
    </CardContent>
  </Card>;
}

