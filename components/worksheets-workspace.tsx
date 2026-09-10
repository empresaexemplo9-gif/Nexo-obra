"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ, ArrowDownWideNarrow, ChartNoAxesCombined, CircleAlert, Columns3, Download, FileSpreadsheet,
  FileText, LoaderCircle, Plus, Rows3, Save, ShieldCheck, Sigma, Table2, Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  cellKey, columnName, deleteColumn, deleteRow, displayValue, evaluateSheet, fillDown,
  insertColumn, insertRow, parseCellKey, sheetToCsv, sortRows,
  SHEET_FUNCTIONS, type SheetCells, type SheetResult,
} from "@/lib/spreadsheet";
import { AnalysisPanel, GrantsPanel } from "@/components/analysis-panel";
import type { AnalysisSettings } from "@/lib/finance-analysis";
import { templateCategories, worksheetTemplates, type TemplateCategory } from "@/lib/worksheet-templates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type WorksheetKind = "sheet" | "document" | "analysis";
type WorksheetSummary = {
  id: string; kind: WorksheetKind; name: string; columns: number; rows: number;
  createdByName: string; revision: number; updatedAt: number; visibility: string; access?: string | null;
};
type WorksheetContent = {
  cells: SheetCells; body: string; widths: Record<string, number>;
  formats: Record<string, string>; bold: string[]; analysis: AnalysisSettings;
};
type Worksheet = WorksheetSummary & { content: WorksheetContent };
type Access = { canView: boolean; canEdit: boolean; canGovern: boolean; level: string };
type DataSource = { id: string; label: string; headers: string[] };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body as T;
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([`﻿${content}`], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Grid({
  cells, columns, rows, computed, active, onActive, onChange,
}: {
  cells: SheetCells; columns: number; rows: number; computed: SheetResult;
  active: string; onActive: (key: string) => void; onChange: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function commit() {
    if (editing) onChange(editing, draft);
    setEditing(null);
  }
  function move(key: string, deltaColumn: number, deltaRow: number) {
    const address = parseCellKey(key);
    if (!address) return;
    const next = cellKey({
      column: Math.max(0, Math.min(columns - 1, address.column + deltaColumn)),
      row: Math.max(0, Math.min(rows - 1, address.row + deltaRow)),
    });
    onActive(next);
    document.getElementById(`cell-${next}`)?.focus();
  }

  return <div className="overflow-auto rounded-md border border-hoikos-200 bg-white" style={{ maxHeight: "62vh" }}>
    <table className="border-collapse text-sm">
      <thead className="sticky top-0 z-10">
        <tr>
          <th className="sticky left-0 z-20 w-12 border border-hoikos-200 bg-hoikos-100 p-1 text-xs font-medium text-hoikos-600">#</th>
          {Array.from({ length: columns }, (_, column) => (
            <th key={column} className="min-w-[7.5rem] border border-hoikos-200 bg-hoikos-100 p-1 text-xs font-medium text-hoikos-700">{columnName(column)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, row) => (
          <tr key={row}>
            <th className="sticky left-0 z-10 border border-hoikos-200 bg-hoikos-100 p-1 text-xs font-medium text-hoikos-600">{row + 1}</th>
            {Array.from({ length: columns }, (_, column) => {
              const key = cellKey({ column, row });
              const result = computed[key];
              const isActive = active === key;
              const isEditing = editing === key;
              return <td key={key} className={`border p-0 ${isActive ? "border-hoikos-700 ring-1 ring-hoikos-700" : "border-hoikos-200"}`}>
                {isEditing ? (
                  <input
                    autoFocus value={draft} aria-label={`Célula ${key}`}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); commit(); move(key, 0, 1); }
                      if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                      if (event.key === "Tab") { event.preventDefault(); commit(); move(key, event.shiftKey ? -1 : 1, 0); }
                    }}
                    className="h-8 w-full min-w-[7.5rem] bg-white px-2 font-mono text-[13px] outline-none"
                  />
                ) : (
                  <button
                    type="button" id={`cell-${key}`}
                    aria-label={`Célula ${key}${result?.display ? `, ${result.display}` : ", vazia"}`}
                    onFocus={() => onActive(key)}
                    onClick={() => onActive(key)}
                    onDoubleClick={() => { setDraft(cells[key] ?? ""); setEditing(key); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); setDraft(cells[key] ?? ""); setEditing(key); return; }
                      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onChange(key, ""); return; }
                      if (event.key === "ArrowRight") { event.preventDefault(); move(key, 1, 0); }
                      if (event.key === "ArrowLeft") { event.preventDefault(); move(key, -1, 0); }
                      if (event.key === "ArrowDown") { event.preventDefault(); move(key, 0, 1); }
                      if (event.key === "ArrowUp") { event.preventDefault(); move(key, 0, -1); }
                      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) { setDraft(event.key); setEditing(key); }
                    }}
                    className={`h-8 w-full min-w-[7.5rem] truncate px-2 text-left ${result?.error ? "text-hoikos-700" : typeof result?.value === "number" ? "text-right tabular-nums" : ""}`}
                  >{result?.display ?? ""}</button>
                )}
              </td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

export function WorksheetsWorkspace({ query = "" }: { query?: string }) {
  const [list, setList] = useState<WorksheetSummary[]>([]);
  const [current, setCurrent] = useState<Worksheet | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [canGovern, setCanGovern] = useState(false);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [active, setActive] = useState("A1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const formulaRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    const result = await api<{ worksheets: WorksheetSummary[]; canGovern: boolean }>("/api/worksheets");
    setList(result.worksheets);
    setCanGovern(result.canGovern);
    return result.worksheets;
  }, []);

  const open = useCallback(async (id: string) => {
    setError("");
    const result = await api<{ worksheet: Worksheet; access: Access }>(`/api/worksheets/${id}`);
    setCurrent(result.worksheet);
    setAccess(result.access);
    setActive("A1");
    setDirty(false);
  }, []);

  const readOnly = access ? !access.canEdit : false;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [worksheets] = await Promise.all([
            loadList(),
            api<{ sources: DataSource[] }>("/api/worksheets/data").then((result) => setSources(result.sources)).catch(() => undefined),
          ]);
          if (worksheets[0]) await open(worksheets[0].id);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Não foi possível carregar.");
        } finally { setLoading(false); }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadList, open]);

  const computed = useMemo(() => evaluateSheet(current?.content.cells ?? {}), [current]);

  const selection = useMemo(() => {
    if (!current) return null;
    const result = computed[active];
    return { raw: current.content.cells[active] ?? "", result };
  }, [computed, current, active]);

  function updateContent(change: (content: WorksheetContent) => WorksheetContent) {
    setCurrent((sheet) => (sheet ? { ...sheet, content: change(sheet.content) } : sheet));
    setDirty(true);
  }

  // Estrutura da planilha. Cada operação já reajusta as fórmulas em lib/spreadsheet.
  function structural(operation: "insert-row" | "delete-row" | "insert-column" | "delete-column" | "fill-down") {
    const address = parseCellKey(active);
    if (!current || !address || readOnly) return;
    setCurrent((sheet) => {
      if (!sheet) return sheet;
      const cells = sheet.content.cells;
      const next =
        operation === "insert-row" ? insertRow(cells, address.row)
        : operation === "delete-row" ? deleteRow(cells, address.row)
        : operation === "insert-column" ? insertColumn(cells, address.column)
        : operation === "delete-column" ? deleteColumn(cells, address.column)
        : fillDown(cells, active, sheet.rows - 1);
      return {
        ...sheet,
        rows: operation === "insert-row" ? Math.min(500, sheet.rows + 1) : sheet.rows,
        columns: operation === "insert-column" ? Math.min(52, sheet.columns + 1) : sheet.columns,
        content: { ...sheet.content, cells: next },
      };
    });
    setDirty(true);
  }

  function sort(direction: "asc" | "desc") {
    const address = parseCellKey(active);
    if (!current || !address || readOnly) return;
    const result = sortRows(current.content.cells, {
      columns: current.columns, rows: current.rows,
      headerRow: current.content.analysis.headerRow, column: address.column, direction,
    });
    if (result.blocked) {
      toast.error("Há fórmula nas linhas a ordenar. Ordenar moveria as referências para o lugar errado.");
      return;
    }
    updateContent((content) => ({ ...content, cells: result.cells }));
    toast.success("Linhas reordenadas");
  }

  function updateCell(key: string, value: string) {
    if (readOnly) return;
    setCurrent((sheet) => {
      if (!sheet) return sheet;
      const cells = { ...sheet.content.cells };
      if (value.trim() === "") delete cells[key]; else cells[key] = value;
      return { ...sheet, content: { ...sheet.content, cells } };
    });
    setDirty(true);
  }

  async function create(kind: WorksheetKind, templateId?: string) {
    try {
      const template = templateId ? worksheetTemplates.find((item) => item.id === templateId) : null;
      const label = template ? template.name
        : kind === "sheet" ? "Planilha" : kind === "document" ? "Documento" : "Saúde financeira";
      const existing = list.filter((item) => item.name === label || item.name.startsWith(`${label} `)).length;
      const name = existing ? `${label} ${existing + 1}` : label;
      const result = await api<{ worksheet: Worksheet }>("/api/worksheets", { method: "POST", body: JSON.stringify({ name, kind, templateId }) });
      await loadList();
      setCurrent(result.worksheet);
      setAccess({ canView: true, canEdit: true, canGovern: kind === "analysis", level: "superadmin" });
      setDirty(false);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível criar."); }
  }

  async function save() {
    if (!current) return;
    setSaving(true); setError("");
    try {
      const result = await api<{ worksheet: Worksheet }>(`/api/worksheets/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: current.name, columns: current.columns, rows: current.rows, content: current.content, revision: current.revision }),
      });
      setCurrent(result.worksheet);
      setDirty(false);
      await loadList();
      toast.success("Salvo");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!current) return;
    try {
      await api(`/api/worksheets/${current.id}`, { method: "DELETE" });
      const remaining = await loadList();
      setCurrent(null);
      if (remaining[0]) await open(remaining[0].id);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível excluir."); }
  }

  // Cola a tabela real a partir da célula selecionada, já com a fórmula de total.
  async function insertSource(sourceId: string) {
    if (!current || !sourceId) return;
    const anchor = parseCellKey(active) ?? { column: 0, row: 0 };
    try {
      const result = await api<{ headers: string[]; rows: Array<Array<string | number>> }>(
        `/api/worksheets/data?source=${sourceId}&startLine=${anchor.row + 1}`);
      if (!result.rows.length) { toast.info("Não há dados reais para essa origem ainda."); return; }
      setCurrent((sheet) => {
        if (!sheet) return sheet;
        const cells = { ...sheet.content.cells };
        result.headers.forEach((header, column) => { cells[cellKey({ column: anchor.column + column, row: anchor.row })] = header; });
        result.rows.forEach((row, line) => row.forEach((value, column) => {
          const key = cellKey({ column: anchor.column + column, row: anchor.row + line + 1 });
          cells[key] = typeof value === "number" ? String(value) : String(value ?? "");
        }));
        const widest = anchor.column + result.headers.length;
        const tallest = anchor.row + result.rows.length + 1;
        return {
          ...sheet,
          columns: Math.max(sheet.columns, Math.min(52, widest)),
          rows: Math.max(sheet.rows, Math.min(500, tallest + 2)),
          content: { ...sheet.content, cells },
        };
      });
      setDirty(true);
      toast.success(`${result.rows.length} linha(s) reais inseridas`);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível trazer os dados."); }
  }

  function insertFunction(name: string) {
    if (!name || !current) return;
    const address = parseCellKey(active);
    const suggestion = address && address.row > 0
      ? `=${name}(${columnName(address.column)}1:${columnName(address.column)}${address.row})`
      : `=${name}()`;
    updateCell(active, suggestion);
    formulaRef.current?.focus();
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return normalized ? list.filter((item) => item.name.toLocaleLowerCase("pt-BR").includes(normalized)) : list;
  }, [list, query]);

  if (loading) return <Card><CardContent className="grid min-h-64 place-items-center"><LoaderCircle className="size-6 animate-spin text-hoikos-600" /></CardContent></Card>;

  return <div className="space-y-5">
    <Card className="workspace-card">
      <CardHeader className="gap-3">
        <CardTitle className="flex items-center gap-2 text-base"><Sigma className="size-4 text-hoikos-600" />Planilha e documento</CardTitle>
        <p className="text-sm leading-6 text-hoikos-500">
          Traga os dados reais da empresa e deixe a soma pronta. As fórmulas usam nomes em português — SOMA, MÉDIA, SE,
          SOMASE, PROCV, ARRED — com vírgula decimal e ponto e vírgula separando argumentos, como no Excel em português.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void create("sheet")}><Plus />Nova planilha</Button>
        <Button size="sm" variant="outline" onClick={() => void create("document")}><FileText />Novo documento</Button>
        {canGovern ? <Button size="sm" variant="outline" onClick={() => void create("analysis")}><ChartNoAxesCombined />Nova planilha de saúde financeira</Button> : null}
        {list.length ? <NativeSelect aria-label="Abrir" value={current?.id ?? ""} onChange={(event) => void open(event.target.value)} className="h-9 max-w-[16rem]">
          {filtered.map((item) => <option key={item.id} value={item.id}>{item.kind === "sheet" ? "▦" : "▤"} {item.name}</option>)}
        </NativeSelect> : null}
      </CardContent>
    </Card>

    {error ? <Card className="border-hoikos-200"><CardContent className="flex items-center gap-3 p-4 text-sm text-hoikos-800"><CircleAlert className="size-5 shrink-0" />{error}</CardContent></Card> : null}

    {!current ? (
      <div className="space-y-5">
        <Card><CardHeader className="gap-2">
          <CardTitle className="text-base">Comece por um modelo</CardTitle>
          <p className="text-sm leading-6 text-hoikos-500">
            Cada modelo já vem com o cabeçalho, as fórmulas e o papel de cada coluna marcado, então a leitura
            financeira funciona desde a primeira linha digitada. Nenhum traz dado de exemplo: a estrutura ajuda,
            número inventado atrapalha.
          </p>
        </CardHeader></Card>
        {(Object.keys(templateCategories) as TemplateCategory[]).map((category) => (
          <section key={category} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-hoikos-600">{templateCategories[category]}</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {worksheetTemplates.filter((template) => template.category === category).map((template) => (
                <Card key={template.id} className="flex flex-col">
                  <CardHeader className="gap-1.5 pb-3">
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <p className="text-sm leading-6 text-hoikos-600">{template.purpose}</p>
                  </CardHeader>
                  <CardContent className="mt-auto space-y-3 pt-0">
                    <p className="text-xs leading-5 text-hoikos-500">{template.note}</p>
                    <p className="text-xs text-hoikos-500">{template.headers.filter(Boolean).join(" · ")}</p>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => void create("sheet", template.id)}>
                      <Plus />Usar este modelo
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
        <Card><CardContent className="flex flex-wrap items-center gap-3 p-5">
          <FileSpreadsheet className="size-6 text-hoikos-500" />
          <p className="min-w-0 flex-1 text-sm text-hoikos-600">Prefere começar do zero? A planilha em branco aceita qualquer dado e você marca os papéis depois.</p>
          <Button variant="outline" onClick={() => void create("sheet")}><Plus />Planilha em branco</Button>
        </CardContent></Card>
      </div>
    ) : <Card className="overflow-hidden">
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Nome" value={current.name} readOnly={readOnly} onChange={(event) => { setCurrent({ ...current, name: event.target.value }); setDirty(true); }} className="h-9 max-w-xs font-medium" />
          <Badge variant="outline">{current.kind === "sheet" ? "Planilha" : current.kind === "document" ? "Documento" : "Saúde financeira"}</Badge>
          {current.visibility === "restricted" ? <Badge variant="outline" className="gap-1 border-hoikos-300"><ShieldCheck className="size-3" />Acesso liberado pelo superadmin</Badge> : null}
          {dirty ? <Badge variant="outline" className="border-hoikos-300">Não salvo</Badge> : <span className="text-xs text-hoikos-500">Revisão {current.revision}</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {sources.length ? <NativeSelect aria-label="Inserir dados reais" value="" onChange={(event) => { void insertSource(event.target.value); event.target.value = ""; }} className="h-9">
              <option value="">Inserir dados reais…</option>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
            </NativeSelect> : null}
            <Button size="sm" variant="outline" onClick={() => download(`${current.name}.csv`, sheetToCsv(current.content.cells, current.columns, current.rows), "text/csv;charset=utf-8")}><Download />CSV</Button>
            {readOnly ? null : <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}Salvar</Button>}
            {readOnly || (current.visibility === "restricted" && !access?.canGovern) ? null
              : <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label="Excluir"><Trash2 /></Button>}
          </div>
        </div>
        {current.kind !== "document" ? <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 rounded-md border border-hoikos-200 bg-hoikos-50 px-2 py-1 text-center font-mono text-xs">{active}</span>
          <Input
            ref={formulaRef} aria-label="Conteúdo da célula" value={selection?.raw ?? ""}
            readOnly={readOnly} onChange={(event) => updateCell(active, event.target.value)}
            placeholder="Digite um valor ou uma fórmula começando por ="
            className="h-9 flex-1 font-mono text-[13px]"
          />
          <NativeSelect aria-label="Inserir função" value="" onChange={(event) => { insertFunction(event.target.value); event.target.value = ""; }} className="h-9 max-w-[11rem]">
            <option value="">Função…</option>
            {SHEET_FUNCTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
          </NativeSelect>
          <span className={`min-w-[6rem] text-right text-sm tabular-nums ${selection?.result?.error ? "text-hoikos-700" : "font-semibold text-hoikos-900"}`}>
            {selection?.result?.display ?? ""}
          </span>
        </div> : null}
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        {current.kind === "document" ? <DocumentEditor
          body={current.content.body}
          cells={current.content.cells}
          onChange={(body) => { updateContent((content) => ({ ...content, body })); }}
        /> : (
          <Tabs defaultValue="grade">
            <TabsList>
              <TabsTrigger value="grade">Planilha</TabsTrigger>
              <TabsTrigger value="leitura">Leitura financeira</TabsTrigger>
              {access?.canGovern ? <TabsTrigger value="acesso">Acesso</TabsTrigger> : null}
            </TabsList>

            <TabsContent value="grade" className="mt-4 space-y-3">
              {readOnly ? <p className="rounded-md border border-hoikos-200 bg-hoikos-50 px-3 py-2 text-sm text-hoikos-800">
                Seu acesso a esta planilha é somente de leitura.
              </p> : (
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-hoikos-200 bg-hoikos-50 p-2">
                  <Button size="sm" variant="ghost" onClick={() => structural("insert-row")}><Rows3 />Inserir linha</Button>
                  <Button size="sm" variant="ghost" onClick={() => structural("delete-row")}>Remover linha</Button>
                  <span className="mx-1 h-5 w-px bg-hoikos-200" />
                  <Button size="sm" variant="ghost" onClick={() => structural("insert-column")}><Columns3 />Inserir coluna</Button>
                  <Button size="sm" variant="ghost" onClick={() => structural("delete-column")}>Remover coluna</Button>
                  <span className="mx-1 h-5 w-px bg-hoikos-200" />
                  <Button size="sm" variant="ghost" onClick={() => structural("fill-down")}>Preencher para baixo</Button>
                  <Button size="sm" variant="ghost" onClick={() => sort("asc")}><ArrowDownAZ />Ordenar ↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => sort("desc")}><ArrowDownWideNarrow />Ordenar ↓</Button>
                </div>
              )}
              <Grid
                cells={current.content.cells} columns={current.columns} rows={current.rows}
                computed={computed} active={active} onActive={setActive} onChange={updateCell}
              />
              <p className="text-xs leading-5 text-hoikos-500">
                Enter ou F2 edita, setas navegam, Tab anda na linha, Delete limpa. Inserir e remover linha ou coluna
                reajusta as fórmulas. Total da coluna do cursor:{" "}
                <strong className="tabular-nums">{displayValue(sumOfColumn(current.content.cells, active))}</strong>
              </p>
            </TabsContent>

            <TabsContent value="leitura" className="mt-4">
              <AnalysisPanel
                cells={current.content.cells} columns={current.columns} rows={current.rows}
                settings={current.content.analysis} canEdit={!readOnly}
                onChange={(analysis) => updateContent((content) => ({ ...content, analysis }))}
              />
            </TabsContent>

            {access?.canGovern ? <TabsContent value="acesso" className="mt-4"><GrantsPanel worksheetId={current.id} /></TabsContent> : null}
          </Tabs>
        )}
      </CardContent>
    </Card>}
  </div>;
}

function sumOfColumn(cells: SheetCells, active: string) {
  const address = parseCellKey(active);
  if (!address) return 0;
  const computed = evaluateSheet(cells);
  let total = 0;
  for (const [key, result] of Object.entries(computed)) {
    const cell = parseCellKey(key);
    if (cell && cell.column === address.column && typeof result.value === "number") total += result.value;
  }
  return Number(total.toPrecision(15));
}

// O documento aceita os mesmos cálculos: {{=SOMA(A1:A9)}} vira o número já somado.
function DocumentEditor({ body, cells, onChange }: { body: string; cells: SheetCells; onChange: (body: string) => void }) {
  const preview = useMemo(() => {
    const computed = evaluateSheet(cells);
    return body.replace(/\{\{(.+?)\}\}/g, (_match, expression: string) => {
      const trimmed = expression.trim();
      const direct = computed[trimmed.toUpperCase()];
      if (direct) return direct.display;
      const single = evaluateSheet({ ...cells, __CALC__: trimmed.startsWith("=") ? trimmed : `=${trimmed}` });
      return single.__CALC__?.display ?? "";
    });
  }, [body, cells]);

  return <div className="grid gap-4 lg:grid-cols-2">
    <div>
      <label className="mb-2 block text-sm font-medium" htmlFor="document-body">Texto</label>
      <Textarea
        id="document-body" value={body} onChange={(event) => onChange(event.target.value)}
        placeholder={"Proposta comercial\n\nTotal dos serviços: {{=SOMA(A1:A20)}}\nValor por m²: {{=ARRED(B1/B2;2)}}"}
        className="min-h-[46vh] font-mono text-[13px]"
      />
      <p className="mt-2 text-xs leading-5 text-hoikos-500">
        Escreva o texto e use <code>{"{{=SOMA(A1:A20)}}"}</code> ou <code>{"{{B4}}"}</code> para trazer um número da planilha
        desta mesma peça. O cálculo é refeito a cada alteração.
      </p>
    </div>
    <div>
      <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Table2 className="size-4 text-hoikos-600" />Como fica</p>
      <div className="min-h-[46vh] whitespace-pre-wrap rounded-md border border-hoikos-200 bg-white p-4 text-sm leading-7 text-hoikos-900">{preview}</div>
    </div>
  </div>;
}
