"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDownAZ, ArrowDownWideNarrow, ChartNoAxesCombined, CircleAlert, Columns3, Download, FileSpreadsheet,
  AlignCenter, AlignLeft, AlignRight, Bold, FileText, Italic, LoaderCircle, Plus, Printer, Redo2, RemoveFormatting, Rows3, Save,
  ShieldCheck, Sigma, Strikethrough, Table2, TableCellsMerge, TableCellsSplit, Trash2, Underline, Undo2, WrapText,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  cellKey, columnName, deleteColumn, deleteRow, displayValue, evaluateSheet, fillDown,
  chavesDoRetangulo, insertColumn, insertRow, moveAnalysis, parseCellKey, resumoDaSelecao,
  rotuloDoRetangulo, sheetToCsv, sortRows,
  axisLastFilled, axisRange, axisTotal,
  SHEET_FUNCTIONS, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, type SheetAxis, type SheetCells, type SheetResult,
} from "@/lib/spreadsheet";
import { analisarColagem, rotuloDaColagem } from "@/lib/sheet-clipboard";
import { AnalysisPanel, GrantsPanel } from "@/components/analysis-panel";
import type { AnalysisSettings } from "@/lib/finance-analysis";
import { templateCategories, worksheetTemplates, type TemplateCategory } from "@/lib/worksheet-templates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorksheetToolsPanel, type WorksheetRecipe } from "@/components/worksheet-tools-panel";
import { aplicarSugestao, formattedCell, negativoEmDestaque, placeTable, selectionToTsv, sugestoesDeFuncao, tabelaParaImpressao } from "@/lib/worksheet-tools";
import { useWorksheetHistory } from "@/hooks/use-worksheet-history";
import { WorksheetAdvancedPanel } from "@/components/worksheet-advanced-panel";
import { WorksheetXlsxPanel } from "@/components/worksheet-xlsx-panel";
import { conditionalColors, emptyAdvanced, moveAdvanced, validationIssues, type AdvancedSettings } from "@/lib/worksheet-advanced";
import {
  boundsOf, cellsHiddenByMerge, clearStyles, colorLabels, fillColors, mergeAt, mergeLayout, mergeRange, mergeSpansRows, rangeOf,
  remapRows, setStyle, shiftKeyed, shiftMerges, styleCss, textColors, toggleFlag, unmergeAt, type CellStyle, type CellStyles, type StyleFlag,
} from "@/lib/worksheet-format";

type WorksheetKind = "sheet" | "document" | "analysis";
type WorksheetSummary = {
  id: string; kind: WorksheetKind; name: string; columns: number; rows: number;
  createdByName: string; revision: number; updatedAt: number; visibility: string; access?: string | null;
};
type WorksheetContent = {
  cells: SheetCells; body: string; widths: Record<string, number>;
  formats: Record<string, string>; bold: string[]; analysis: AnalysisSettings;
  recipes?: WorksheetRecipe[];
  advanced?: AdvancedSettings;
  frozenColumns?: number;
  styles?: CellStyles;
  merges?: string[];
};
type Worksheet = WorksheetSummary & { content: WorksheetContent };
type Access = { canView: boolean; canEdit: boolean; canGovern: boolean; canDelete: boolean; level: string };
type DataSource = { id: string; label: string; headers: string[] };

/** Erro de API que preserva o código, para o chamador distinguir conflito de queda. */
class ErroDeApi extends Error {
  constructor(message: string, public codigo?: string) { super(message); }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    // `Failed to fetch` é o texto do navegador, em inglês, e não diz o que fazer.
    throw new ErroDeApi("Sem conexão com o servidor. Seu trabalho continua aqui na tela.", "offline");
  }
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) throw new ErroDeApi(body.error ?? "Não foi possível concluir a operação.", body.code);
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

/** A média vai a 10 casas no formato padrão e estoura a linha em 320 px. Arredondar na
 *  EXIBIÇÃO, nunca no valor: a conta continua exata. */
function arredondarExibicao(valor: number | null) {
  return valor === null ? null : Number(valor.toFixed(2));
}

type AxisSelection = { kind: SheetAxis; index: number };

const LARGURA_PADRAO = 120, LARGURA_MIN = 60, LARGURA_MAX = 600, LARGURA_GUIA = 48;

function Grid({
  cells, columns, rows, computed, active, selected, axis,
  onActive, onEstender, onAxis, onChange, onColar, onDesfazer, onRefazer,
  formats, bold, widths, filter, readOnly, onCopyCells, colors, issues, frozen: fixasPedidas, onWidth, styles, merges, onFormatar,
}: {
  frozen: number; onWidth: (column: number, width: number) => void;
  styles: CellStyles; merges: string[]; onFormatar: (atalho: "bold" | "italic" | "underline") => void;
  colors: Record<string, string>; issues: Map<string, string>;
  formats: Record<string, string>; bold: string[]; widths: Record<string, number>; filter: string; readOnly: boolean;
  onCopyCells: () => string;
  cells: SheetCells; columns: number; rows: number; computed: SheetResult;
  active: string; selected: Set<string>; axis: AxisSelection | null;
  onActive: (key: string, additive?: boolean) => void;
  onEstender: (key: string) => void;
  onAxis: (kind: SheetAxis, index: number) => void; onChange: (key: string, value: string) => void;
  onColar: (texto: string) => void;
  onDesfazer: () => void;
  onRefazer: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const pointerFocus = useRef(false);
  // Arrastar só com mouse/caneta. No toque, o arrasto continua rolando a grade — que é o
  // gesto que a pessoa espera num celular, e o único jeito de alcançar a coluna G.
  const arrastando = useRef(false);
  // Largura durante o arrasto da borda. Só vai para o histórico ao soltar: gravar a cada
  // pixel encheria o desfazer de passos inúteis.
  const [larguraAoVivo, setLarguraAoVivo] = useState<{ column: number; width: number } | null>(null);
  const largura = (column: number) => larguraAoVivo?.column === column ? larguraAoVivo.width : widths[columnName(column)] ?? LARGURA_PADRAO;
  // Deslocamento de cada coluna fixa: a guia de números mais a largura das fixas à esquerda.
  const esquerdaFixa = (column: number) => LARGURA_GUIA + Array.from({ length: column }, (_, index) => largura(index)).reduce((total, value) => total + value, 0);
  const layout = useMemo(() => mergeLayout(merges), [merges]);
  // A guia de números tem largura exata: a coluna fixa é colada nela por `left`, e uma guia
  // mais estreita que o previsto fazia a coluna A cobrir o começo da B.
  // A sombra de 1 px cobre a borda: com `border-collapse`, a borda não acompanha a célula
  // fixa e o texto que rola por baixo aparecia pela fresta.
  const guia: CSSProperties = { width: LARGURA_GUIA, minWidth: LARGURA_GUIA, maxWidth: LARGURA_GUIA, boxShadow: "-1px 0 0 0 var(--color-hoikos-200), 2px 0 0 0 var(--color-hoikos-200)" };
  // Coluna fixa larga numa tela estreita tomaria a grade inteira e travaria a rolagem. Se
  // não sobra ao menos uma coluna visível ao lado, a fixação fica desligada nessa tela.
  const gradeRef = useRef<HTMLDivElement>(null);
  const [larguraVisivel, setLarguraVisivel] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const grade = gradeRef.current;
    if (!grade || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(([entrada]) => { if (entrada) setLarguraVisivel(entrada.contentRect.width); });
    observador.observe(grade);
    return () => observador.disconnect();
  }, []);
  const negrito = useMemo(() => new Set(bold), [bold]);
  const frozen = esquerdaFixa(fixasPedidas) + LARGURA_PADRAO <= larguraVisivel ? fixasPedidas : 0;
  const estiloColuna = (column: number, fundo?: string, ate = column): CSSProperties => {
    // Bloco mesclado ocupa a soma das colunas que cobre.
    const w = Array.from({ length: ate - column + 1 }, (_, index) => largura(column + index)).reduce((total, value) => total + value, 0);
    return {
      width: w, minWidth: w, maxWidth: w,
      ...(column < frozen ? { position: "sticky", left: esquerdaFixa(column), zIndex: 5, backgroundColor: fundo ?? "var(--background)" } : fundo ? { backgroundColor: fundo } : {}),
    };
  };

  useEffect(() => {
    const soltar = () => { arrastando.current = false; };
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
  }, []);

  function commit() {
    if (editing) onChange(editing, draft);
    setEditing(null);
  }
  function move(key: string, deltaColumn: number, deltaRow: number, estender = false) {
    const address = parseCellKey(key);
    if (!address) return;
    // Saindo de um bloco mesclado, a seta parte da borda dele; entrando, para na âncora.
    const bloco = layout.anchors.get(key)?.bounds;
    const origem = bloco ? { column: deltaColumn > 0 ? bloco.right : address.column, row: deltaRow > 0 ? bloco.bottom : address.row } : address;
    const vizinha = cellKey({
      column: Math.max(0, Math.min(columns - 1, origem.column + deltaColumn)),
      row: Math.max(0, Math.min(rows - 1, origem.row + deltaRow)),
    });
    const next = layout.covered.get(vizinha) ?? vizinha;
    if (estender) onEstender(next); else onActive(next);
    document.getElementById(`cell-${next}`)?.focus();
  }

  // `select-none`: sem isso, arrastar sobre a grade selecionava o texto das células —
  // o gesto já existia e produzia um efeito feio e sem função nenhuma.
  return <div ref={gradeRef} className="select-none overflow-auto rounded-md border border-hoikos-200 bg-white" style={{ maxHeight: "62vh" }} onCopy={event => {
    if (editing) return;
    event.preventDefault(); event.clipboardData.setData("text/plain", onCopyCells());
  }} onPaste={event => {
    if (readOnly || editing) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    try { onColar(text); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível colar."); }
  }}>
    <table className="border-collapse text-sm">
      <thead className="sticky top-0 z-10">
        <tr>
          <th style={guia} className="sticky left-0 z-20 border border-hoikos-200 bg-hoikos-100 p-1 text-xs font-medium text-hoikos-600">#</th>
          {Array.from({ length: columns }, (_, column) => (
            <th key={column} style={{ ...estiloColuna(column, "var(--color-hoikos-100, #f1f5f9)"), ...(column < frozen ? { zIndex: 25, boxShadow: "1px 0 0 0 var(--color-hoikos-200)" } : {}) }} className="relative border border-hoikos-200 p-0 text-xs font-medium">
              <button
                type="button" onClick={() => onAxis("column", column)}
                aria-label={`Selecionar coluna ${columnName(column)}`}
                aria-pressed={axis?.kind === "column" && axis.index === column}
                className={`h-7 w-full px-1 ${axis?.kind === "column" && axis.index === column ? "bg-hoikos-700 text-white" : "bg-hoikos-100 text-hoikos-700"}`}
              >{columnName(column)}</button>
              {readOnly ? null : <div
                role="separator" aria-orientation="vertical" tabIndex={0}
                aria-label={`Largura da coluna ${columnName(column)}`}
                aria-valuemin={LARGURA_MIN} aria-valuemax={LARGURA_MAX} aria-valuenow={largura(column)}
                title="Arraste para ajustar a largura. Com o teclado, use as setas."
                className="absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none outline-none hover:bg-hoikos-400 focus-visible:bg-hoikos-600"
                onPointerDown={(event) => {
                  event.preventDefault();
                  const inicio = event.clientX, base = largura(column);
                  const alvo = event.currentTarget;
                  alvo.setPointerCapture(event.pointerId);
                  const mover = (evento: PointerEvent) => setLarguraAoVivo({ column, width: Math.max(LARGURA_MIN, Math.min(LARGURA_MAX, Math.round(base + evento.clientX - inicio))) });
                  const soltar = (evento: PointerEvent) => {
                    alvo.removeEventListener("pointermove", mover);
                    alvo.removeEventListener("pointerup", soltar);
                    alvo.removeEventListener("pointercancel", soltar);
                    const final = Math.max(LARGURA_MIN, Math.min(LARGURA_MAX, Math.round(base + evento.clientX - inicio)));
                    setLarguraAoVivo(null);
                    if (final !== base) onWidth(column, final);
                  };
                  alvo.addEventListener("pointermove", mover);
                  alvo.addEventListener("pointerup", soltar);
                  alvo.addEventListener("pointercancel", soltar);
                }}
                onKeyDown={(event) => {
                  const passo = event.shiftKey ? 40 : 10;
                  const atual = largura(column);
                  if (event.key === "ArrowRight") { event.preventDefault(); onWidth(column, Math.min(LARGURA_MAX, atual + passo)); }
                  if (event.key === "ArrowLeft") { event.preventDefault(); onWidth(column, Math.max(LARGURA_MIN, atual - passo)); }
                }}
              />}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, row) => (
          <tr key={row} hidden={!!filter.trim() && !Array.from({ length: columns }, (_, column) => formattedCell(computed[cellKey({ column, row })], formats[columnName(column)])).join(" ").toLocaleLowerCase("pt-BR").includes(filter.trim().toLocaleLowerCase("pt-BR"))}>
            <th style={guia} className="sticky left-0 z-10 border border-hoikos-200 bg-hoikos-100 p-0 text-xs font-medium">
              <button
                type="button" onClick={() => onAxis("row", row)}
                aria-label={`Selecionar linha ${row + 1}`}
                aria-pressed={axis?.kind === "row" && axis.index === row}
                className={`h-8 w-full px-1 ${axis?.kind === "row" && axis.index === row ? "bg-hoikos-700 text-white" : "bg-hoikos-100 text-hoikos-600"}`}
              >{row + 1}</button>
            </th>
            {Array.from({ length: columns }, (_, column) => {
              const key = cellKey({ column, row });
              if (layout.covered.has(key)) return null;
              const bloco = layout.anchors.get(key);
              const estilo = styles[key];
              const result = computed[key];
              const isActive = active === key;
              const isEditing = editing === key;
              const inAxis = axis ? (axis.kind === "row" ? axis.index === row : axis.index === column) : false;
              const isSelected = selected.has(key);
              const fixa = column < frozen;
              const marcada = inAxis || isSelected;
              // A cor condicional é regra de dado e vence o preenchimento escolhido à mão.
              const fundo = colors[key] ?? (estilo?.fill ? fillColors[estilo.fill] : undefined);
              return <td
                key={key} title={issues.get(key)}
                colSpan={bloco?.colSpan} rowSpan={bloco?.rowSpan}
                style={{
                  ...estiloColuna(column, fundo ?? (fixa && marcada ? "var(--color-hoikos-50)" : undefined), bloco ? bloco.bounds.right : column),
                  // Com fundo próprio, a seleção vira um véu por cima, senão sumiria.
                  ...(fundo && marcada ? { backgroundImage: "linear-gradient(rgba(15,23,42,.1),rgba(15,23,42,.1))" } : {}),
                  ...(bloco && bloco.rowSpan > 1 ? { height: 1 } : {}),
                  boxShadow: issues.has(key) ? "inset 0 -3px #dc2626" : undefined,
                  // Célula fixa desenha a própria borda: com `border-collapse` a borda não
                  // acompanha o `sticky` e o texto que rola por baixo aparecia pela fresta.
                  ...(fixa ? { outline: `${isActive ? 2 : 1}px solid ${isActive ? "var(--color-hoikos-700)" : "var(--color-hoikos-200)"}`, outlineOffset: -1 } : {}),
                  fontWeight: negrito.has(key) ? 700 : undefined,
                }}
                className={`border p-0 ${marcada ? "bg-hoikos-50" : ""} ${isActive ? "border-hoikos-700 ring-1 ring-hoikos-700" : "border-hoikos-200"}`}
              >
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
                    className="h-8 w-full bg-white px-2 font-mono text-[13px] outline-none"
                  />
                ) : (
                  <button
                    type="button" id={`cell-${key}`}
                    aria-label={`Célula ${key}${result?.display ? `, ${result.display}` : ", vazia"}`}
                    aria-pressed={isSelected || inAxis}
                    onMouseDown={() => { pointerFocus.current = true; }}
                    onFocus={() => { if (!pointerFocus.current) onActive(key); }}
                    onPointerDown={(event) => {
                      // No toque o arrasto rola a grade, que é o gesto esperado no celular
                      // e o único jeito de alcançar a coluna G numa tela de 320 px.
                      if (event.pointerType === "touch") return;
                      // Com modificador quem decide é o clique, que chega depois e é o
                      // mesmo caminho do teclado e do toque.
                      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                      // A ÂNCORA NASCE AQUI, onde o gesto começa. Deixá-la para o `click`
                      // era o mesmo que não ter âncora: o clique só chega quando o botão
                      // é solto, e num arrasto que termina em outra célula ele não chega
                      // nunca. O retângulo saía da seleção anterior em vez da célula
                      // apertada.
                      onActive(key);
                      arrastando.current = true;
                    }}
                    // `pointerover`, não `pointerenter`: o React sintetiza o `enter` a
                    // partir deste, então é este que chega de verdade ao handler.
                    onPointerOver={(event) => {
                      // `buttons & 1` confirma que o botão ainda está pressionado: sem
                      // isso, passar o mouse depois de soltar continuaria marcando.
                      if (arrastando.current && (event.buttons & 1) === 1) onEstender(key);
                    }}
                    onClick={(event) => {
                      pointerFocus.current = false;
                      if (event.shiftKey) { onEstender(key); return; }
                      onActive(key, event.ctrlKey || event.metaKey);
                    }}
                    onDoubleClick={() => { if (!readOnly) { setDraft(cells[key] ?? ""); setEditing(key); } }}
                    onKeyDown={(event) => {
                      if (readOnly && !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Tab"].includes(event.key)) return;
                      // Desfazer/refazer antes de tudo: é atalho com modificador, e o
                      // resto do handler trata tecla solta. Ficam presos à grade de
                      // propósito — Ctrl+Z no campo de nome da planilha tem que
                      // continuar desfazendo o que a pessoa digitou lá.
                      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
                        const tecla = event.key.toLowerCase();
                        if (tecla === "z" && !event.shiftKey) { event.preventDefault(); onDesfazer(); return; }
                        // Ctrl+Shift+Z e Ctrl+Y: o primeiro é o de quem veio do Google
                        // Sheets, o segundo o de quem veio do Excel no Windows.
                        if ((tecla === "z" && event.shiftKey) || tecla === "y") { event.preventDefault(); onRefazer(); return; }
                        if (!event.shiftKey && (tecla === "b" || tecla === "i" || tecla === "u")) {
                          event.preventDefault(); onFormatar(tecla === "b" ? "bold" : tecla === "i" ? "italic" : "underline"); return;
                        }
                      }
                      if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); setDraft(cells[key] ?? ""); setEditing(key); return; }
                      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onChange(key, ""); return; }
                      // Com Shift a seta ESTENDE a faixa em vez de mover o cursor. É o que
                      // todo mundo que veio do Excel tenta antes de tentar arrastar, e no
                      // celular é a única forma sensata de marcar um intervalo.
                      if (event.key === "ArrowRight") { event.preventDefault(); move(key, 1, 0, event.shiftKey); }
                      if (event.key === "ArrowLeft") { event.preventDefault(); move(key, -1, 0, event.shiftKey); }
                      if (event.key === "ArrowDown") { event.preventDefault(); move(key, 0, 1, event.shiftKey); }
                      if (event.key === "ArrowUp") { event.preventDefault(); move(key, 0, -1, event.shiftKey); }
                      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
                        // A tecla que abre o editor não pode também cair no input recém-montado.
                        // Sem o preventDefault, "1" podia virar "11" e "a" virar "aa".
                        event.preventDefault();
                        setDraft(event.key);
                        setEditing(key);
                      }
                    }}
                    style={styleCss(estilo)}
                    className={`w-full px-2 text-left ${estilo?.wrap ? `min-h-8 py-1 ${bloco && bloco.rowSpan > 1 ? "h-full" : ""}` : bloco && bloco.rowSpan > 1 ? "h-full min-h-8 truncate" : "h-8 truncate"} ${result?.error ? "text-hoikos-700" : typeof result?.value === "number" ? "text-right tabular-nums" : ""} ${negativoEmDestaque(result, formats[columnName(column)]) ? "text-red-700" : ""}`}
                  >{formattedCell(result, formats[columnName(column)])}</button>
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
  const history = useWorksheetHistory<Worksheet>();
  const { current, set: setCurrent, reset: resetCurrent } = history;
  const [rowFilter, setRowFilter] = useState("");
  const [access, setAccess] = useState<Access | null>(null);
  const [canGovern, setCanGovern] = useState(false);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [active, setActive] = useState("A1");
  // A seleção é um RETÂNGULO (âncora → foco) mais as avulsas do Ctrl + clique. Era uma
  // lista solta de chaves, que não tinha como representar "da linha 2 até a 31".
  const [faixa, setFaixa] = useState<{ ancora: string; foco: string } | null>({ ancora: "A1", foco: "A1" });
  const [avulsas, setAvulsas] = useState<string[]>([]);
  const [axis, setAxis] = useState<AxisSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  // Conflito de edição: a planilha mudou em outro acesso. Guardamos a versão do servidor
  // para a pessoa DECIDIR, em vez de escolher por ela — o trabalho na tela é dela.
  const [conflito, setConflito] = useState<Worksheet | null>(null);
  const formulaRef = useRef<HTMLInputElement>(null);

  // Fechar a aba ou dar F5 com alteração pendente é perda de trabalho, não de rascunho.
  // O aviso do navegador é o único que funciona nesse caminho. Mesmo padrão da Prancheta.
  useEffect(() => {
    if (!dirty) return;
    const aviso = (evento: BeforeUnloadEvent) => { evento.preventDefault(); };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [dirty]);

  const loadList = useCallback(async () => {
    const result = await api<{ worksheets: WorksheetSummary[]; canGovern: boolean }>("/api/worksheets");
    setList(result.worksheets);
    setCanGovern(result.canGovern);
    return result.worksheets;
  }, []);

  /**
   * Trocar de planilha com alteração pendente descartava tudo sem perguntar. Confirmar é
   * o mínimo: o trabalho é da pessoa e o clique que o apaga é indistinguível do clique
   * que só queria olhar outra planilha.
   */
  const confirmarDescarte = useCallback(() => {
    if (!dirty) return true;
    return window.confirm("Esta planilha tem alterações não salvas. Continuar sem salvar descarta o que você digitou.");
  }, [dirty]);

  const open = useCallback(async (id: string) => {
    setError("");
    setConflito(null);
    const result = await api<{ worksheet: Worksheet; access: Access }>(`/api/worksheets/${id}`);
    resetCurrent(result.worksheet);
    setAccess(result.access);
    setActive("A1");
    setFaixa({ ancora: "A1", foco: "A1" });
    setAvulsas([]);
    setAxis(null);
    setDirty(false);
    setRowFilter("");
  }, [resetCurrent]);

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
  const advanced = current?.content.advanced ?? emptyAdvanced;
  const colors = useMemo(() => conditionalColors(computed, advanced), [computed, advanced]);
  const issues = useMemo(() => validationIssues(computed, advanced), [computed, advanced]);

  /**
   * Marcar a célula. Sem modificador, recomeça a faixa nela.
   *
   * `aditivo` (Ctrl/⌘) continua somando célula avulsa, para o caso espalhado que o
   * retângulo não cobre.
   */
  const selectCell = useCallback((key: string, additive = false) => {
    setActive(key);
    setAxis(null);
    if (additive) {
      setAvulsas((previous) => previous.includes(key) ? previous.filter((cell) => cell !== key) : [...previous, key]);
      return;
    }
    setAvulsas([]);
    setFaixa({ ancora: key, foco: key });
  }, []);

  /** Estende a faixa até a célula, mantendo a âncora. Shift + clique, arrasto e Shift + setas. */
  const estenderAte = useCallback((key: string) => {
    setAxis(null);
    setActive(key);
    setFaixa((previous) => (previous ? { ...previous, foco: key } : { ancora: key, foco: key }));
  }, []);

  // As células marcadas: o retângulo mais as avulsas do Ctrl + clique.
  const selected = useMemo(() => {
    const chaves = faixa ? chavesDoRetangulo(faixa.ancora, faixa.foco) : [];
    const unicas = new Set(chaves);
    for (const chave of avulsas) unicas.add(chave);
    return [...unicas];
  }, [faixa, avulsas]);

  // Teste de pertencimento por Set: `includes` por célula renderizada era
  // O(células × selecionadas) a cada quadro, e arrastar redesenha a cada movimento.
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // As chaves sobre as quais a barra de resumo fala. Com um eixo escolhido, é o eixo
  // inteiro: clicar no cabeçalho da coluna e ver só o total, sem média nem extremos,
  // seria responder menos do que a mesma marcação feita arrastando.
  const chavesDoResumo = useMemo(() => {
    if (!axis || !current) return selected;
    const limite = axis.kind === "row" ? current.columns : current.rows;
    return Array.from({ length: limite }, (_, posicao) => (axis.kind === "row"
      ? cellKey({ column: posicao, row: axis.index })
      : cellKey({ column: axis.index, row: posicao })));
  }, [axis, current, selected]);

  const resumo = useMemo(() => resumoDaSelecao(computed, chavesDoResumo), [computed, chavesDoResumo]);

  // Clicar no cabeçalho seleciona o eixo inteiro e leva o cursor para a primeira
  // célula livre dele, que é onde o total entra.
  function selectAxis(kind: SheetAxis, index: number) {
    if (!current) return;
    const limit = kind === "row" ? current.columns : current.rows;
    const next = Math.min(axisLastFilled(current.content.cells, kind, index) + 1, limit - 1);
    setAxis({ kind, index });
    setFaixa(null);
    setAvulsas([]);
    const destino = kind === "row" ? cellKey({ column: next, row: index }) : cellKey({ column: index, row: next });
    setActive(mergeAt(current.content.merges ?? [], destino)?.anchor ?? destino);
  }

  // Total do que está selecionado. Sem eixo escolhido vale a coluna do cursor,
  // que era o único comportamento que existia.
  const axisSum = useMemo(() => {
    const target = axis ?? { kind: "column" as SheetAxis, index: parseCellKey(active)?.column ?? 0 };
    return { ...target, total: axisTotal(computed, target.kind, target.index, current?.content.analysis.ignoreRows ?? []) };
  }, [axis, active, computed, current?.content.analysis.ignoreRows]);

  const selection = useMemo(() => {
    if (!current) return null;
    const result = computed[active];
    return { raw: current.content.cells[active] ?? "", result };
  }, [computed, current, active]);

  function aplicar(label: string, change: (sheet: Worksheet) => Worksheet) {
    if (!current || readOnly || saving) return;
    try { const next = change(current); setCurrent(next, label); setDirty(true); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível alterar a planilha."); }
  }
  function updateContent(label: string, change: (content: WorksheetContent) => WorksheetContent): void;
  function updateContent(change: (content: WorksheetContent) => WorksheetContent): void;
  function updateContent(labelOrChange: string | ((content: WorksheetContent) => WorksheetContent), change?: (content: WorksheetContent) => WorksheetContent) {
    const label = typeof labelOrChange === "string" ? labelOrChange : "Alterar ferramentas da planilha";
    const update = typeof labelOrChange === "function" ? labelOrChange : change!;
    aplicar(label, sheet => ({ ...sheet, content: update(sheet.content) }));
  }
  function insertTable(table: string[][]) {
    if (!current || readOnly || saving) return;
    try {
      const result = placeTable(current.content.cells, active, table);
      aplicar(`Colar ${rotuloDaColagem(table)}`, sheet => ({ ...sheet, columns: Math.max(sheet.columns, result.columns), rows: Math.max(sheet.rows, result.rows), content: { ...sheet.content, cells: result.cells } }));
      toast.success(`Colado: ${rotuloDaColagem(table)}`);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível inserir."); }
  }
  function colar(text: string) {
    if (text.length > 2_000_000) { toast.error("A colagem excede 2 MB."); return; }
    // Clipboard from Excel/Sheets is TSV. Guessing commas corrupts decimal values,
    // and guessing semicolons splits formulas. CSV has an explicit delimiter in Tools.
    const table = analisarColagem(text, "\t");
    if (table.length) insertTable(table);
  }
  function travelHistory(direction: "undo" | "redo") {
    if (readOnly || saving) return;
    history[direction](); setDirty(true); setActive("A1"); setAxis(null);
    setFaixa({ ancora: "A1", foco: "A1" }); setAvulsas([]);
  }
  const desfazerAgora = () => travelHistory("undo");
  const refazerAgora = () => travelHistory("redo");

  // Estrutura da planilha. Cada operação já reajusta as fórmulas em lib/spreadsheet.
  function structural(operation: "insert-row" | "delete-row" | "insert-column" | "delete-column" | "fill-down") {
    const address = parseCellKey(active);
    if (!current || !address || readOnly) return;
    if (operation === "insert-row" && current.rows >= SHEET_MAX_ROWS) {
      toast.error(`A planilha já tem o limite de ${SHEET_MAX_ROWS} linhas.`); return;
    }
    if (operation === "insert-column" && current.columns >= SHEET_MAX_COLUMNS) {
      toast.error(`A planilha já tem o limite de ${SHEET_MAX_COLUMNS} colunas.`); return;
    }
    if (operation === "delete-row" && current.rows <= 1) {
      toast.error("A planilha precisa manter pelo menos uma linha."); return;
    }
    if (operation === "delete-column" && current.columns <= 1) {
      toast.error("A planilha precisa manter pelo menos uma coluna."); return;
    }

    const nextRows = operation === "insert-row" ? current.rows + 1
      : operation === "delete-row" ? current.rows - 1 : current.rows;
    const nextColumns = operation === "insert-column" ? current.columns + 1
      : operation === "delete-column" ? current.columns - 1 : current.columns;

    const rotulo =
      operation === "insert-row" ? `Inserir linha ${address.row + 1}`
      : operation === "delete-row" ? `Excluir linha ${address.row + 1}`
      : operation === "insert-column" ? `Inserir coluna ${columnName(address.column)}`
      : operation === "delete-column" ? `Excluir coluna ${columnName(address.column)}`
      : "Preencher para baixo";

    // Com um retângulo marcado, cada coluna dele é preenchida a partir da primeira linha —
    // antes só a coluna do cursor recebia, e as vizinhas ficavam como estavam, sem aviso.
    // Sem retângulo, a coluna do cursor vai até o fim da planilha.
    const preencherFaixa = (cells: SheetCells, totalRows: number) => {
      if (!(selected.length > 1 && faixa)) return fillDown(cells, active, totalRows - 1);
      const a = parseCellKey(faixa.ancora)!, b = parseCellKey(faixa.foco)!;
      const topo = Math.min(a.row, b.row), base = Math.max(a.row, b.row);
      let next = cells;
      for (let column = Math.min(a.column, b.column); column <= Math.max(a.column, b.column); column += 1) {
        next = fillDown(next, cellKey({ column, row: topo }), base);
      }
      return next;
    };

    aplicar(rotulo, (sheet) => {
      const cells = sheet.content.cells;
      const next =
        operation === "insert-row" ? insertRow(cells, address.row)
        : operation === "delete-row" ? deleteRow(cells, address.row)
        : operation === "insert-column" ? insertColumn(cells, address.column)
        : operation === "delete-column" ? deleteColumn(cells, address.column)
        : preencherFaixa(cells, sheet.rows);
      // Os parâmetros guardam posições (letra de coluna, índice de linha). Sem deslocá-los
      // junto, a coluna marcada como "Custo" passa a apontar para a vizinha e a leitura
      // financeira lê a coluna errada, sem erro nenhum na tela.
      const eixo = operation === "insert-row" || operation === "delete-row" ? "row" : "column";
      const alvo = eixo === "row" ? address.row : address.column;
      const passo = operation === "insert-row" || operation === "insert-column" ? 1 : -1;
      const analysis = operation === "fill-down" ? sheet.content.analysis
        : moveAnalysis(sheet.content.analysis, eixo, alvo, passo);
      const boldCells = Object.fromEntries(sheet.content.bold.map(key => [key, "1"]));
      const bold = operation === "fill-down" ? sheet.content.bold : Object.keys(
        operation === "insert-row" ? insertRow(boldCells, address.row) : operation === "delete-row" ? deleteRow(boldCells, address.row)
        : operation === "insert-column" ? insertColumn(boldCells, address.column) : deleteColumn(boldCells, address.column));
      const moveColumns = <T,>(values: Record<string, T>) => {
        if (eixo !== "column" || operation === "fill-down") return values;
        const output: Record<string, T> = {};
        for (const [key, value] of Object.entries(values)) {
          const index = parseCellKey(`${key}1`)?.column;
          if (index === undefined || (passo < 0 && index === alvo)) continue;
          output[columnName(index < alvo ? index : index + passo)] = value;
        }
        return output;
      };
      return {
        ...sheet,
        rows: nextRows,
        columns: nextColumns,
        content: {
          ...sheet.content, cells: next, analysis, bold, formats: moveColumns(sheet.content.formats), widths: moveColumns(sheet.content.widths),
          advanced: operation === "fill-down" ? sheet.content.advanced : moveAdvanced(sheet.content.advanced ?? emptyAdvanced, eixo, alvo, passo),
          // Itálico, cores e mesclagens andam junto com as células, como o negrito.
          styles: operation === "fill-down" ? sheet.content.styles : shiftKeyed(sheet.content.styles ?? {}, eixo, alvo, passo),
          merges: operation === "fill-down" ? sheet.content.merges : shiftMerges(sheet.content.merges ?? [], eixo, alvo, passo),
        },
      };
    });
    if (operation === "delete-row" || operation === "delete-column") {
      setActive(cellKey({
        column: Math.min(address.column, nextColumns - 1),
        row: Math.min(address.row, nextRows - 1),
      }));
    }
    // Inserir ou remover desloca os índices. Manter o eixo selecionado faria o
    // total passar a somar outra linha sem aviso nenhum na tela.
    if (operation !== "fill-down") {
      setAxis(null);
      const dentro = cellKey({ column: Math.min(address.column, nextColumns - 1), row: Math.min(address.row, nextRows - 1) });
      setFaixa({ ancora: dentro, foco: dentro });
      setAvulsas([]);
    }
  }

  function sort(direction: "asc" | "desc") {
    const address = parseCellKey(active);
    if (!current || !address || readOnly) return;
    const result = sortRows(current.content.cells, {
      columns: current.columns, rows: current.rows,
      headerRow: current.content.analysis.headerRow, column: address.column, direction,
      fixedRows: current.content.analysis.ignoreRows,
    });
    if (result.blocked) {
      toast.error("Uma fórmula liga uma linha a outra (como saldo acumulado). Ordenar mudaria o cálculo, então nada foi alterado.");
      return;
    }
    if (mergeSpansRows(current.content.merges ?? [], ...result.range)) {
      toast.error("Há células mescladas entre linhas na faixa. Desfaça a mesclagem para ordenar.");
      return;
    }
    // Negrito, estilos e mesclagens de uma linha só acompanham a linha para onde ela foi.
    // Antes o negrito ficava parado e passava a destacar o item que caiu no lugar.
    const moverMesclagem = (range: string) => {
      const bounds = boundsOf(range);
      if (!bounds || bounds.top !== bounds.bottom || result.destination[bounds.top] === undefined) return range;
      const row = result.destination[bounds.top];
      return rangeOf({ ...bounds, top: row, bottom: row });
    };
    updateContent(
      `Ordenar por ${columnName(address.column)} (${direction === "asc" ? "crescente" : "decrescente"})`,
      (content) => ({
        ...content, cells: result.cells,
        bold: Object.keys(remapRows(Object.fromEntries(content.bold.map((key) => [key, true])), result.destination)),
        styles: remapRows(content.styles ?? {}, result.destination),
        merges: (content.merges ?? []).map(moverMesclagem),
      }),
    );
    toast.success("Linhas reordenadas");
  }

  // ─── Formatação de texto ───
  // Vale para o que está marcado: o retângulo, as avulsas ou a linha/coluna inteira.
  const mesclagens = current?.content.merges ?? [];
  const estilos = current?.content.styles ?? {};
  const mesclagemAtiva = mergeAt(mesclagens, active);
  const todasCom = (teste: (key: string) => boolean) => chavesDoResumo.length > 0 && chavesDoResumo.every(teste);
  const negritoLigado = current ? todasCom((key) => current.content.bold.includes(key)) : false;
  const marcaLigada = (flag: StyleFlag) => todasCom((key) => !!estilos[key]?.[flag]);
  const alinhamentoAtual = (() => {
    const primeiro = estilos[chavesDoResumo[0] ?? active]?.align;
    return primeiro && todasCom((key) => estilos[key]?.align === primeiro) ? primeiro : "";
  })();
  const valorComum = (campo: "color" | "fill") => {
    const primeiro = estilos[chavesDoResumo[0] ?? active]?.[campo];
    return primeiro && todasCom((key) => estilos[key]?.[campo] === primeiro) ? primeiro : "";
  };
  const nomeDaMarca: Record<StyleFlag | "bold", string> = { bold: "negrito", italic: "itálico", underline: "sublinhado", strike: "tachado", wrap: "quebra de texto" };

  function alternarNegrito() {
    const chosen = chavesDoResumo;
    updateContent(`Alternar ${nomeDaMarca.bold}`, content => {
      const bold = new Set(content.bold); const remove = chosen.every(key => bold.has(key));
      chosen.forEach(key => { if (remove) bold.delete(key); else bold.add(key); });
      if (bold.size > 5000) throw new Error("Selecione até 5.000 células para negrito.");
      return { ...content, bold: [...bold] };
    });
  }
  function alternarMarca(flag: StyleFlag) {
    updateContent(`Alternar ${nomeDaMarca[flag]}`, content => ({ ...content, styles: toggleFlag(content.styles ?? {}, chavesDoResumo, flag) }));
  }
  function formatarAtalho(atalho: "bold" | "italic" | "underline") {
    if (atalho === "bold") alternarNegrito(); else alternarMarca(atalho);
  }
  function definirEstilo<K extends "align" | "color" | "fill">(campo: K, valor: CellStyle[K] | undefined, rotulo: string) {
    updateContent(rotulo, content => ({ ...content, styles: setStyle(content.styles ?? {}, chavesDoResumo, campo, valor) }));
  }
  function limparFormatacao() {
    const alvo = new Set(chavesDoResumo);
    updateContent("Limpar formatação", content => ({ ...content, styles: clearStyles(content.styles ?? {}, chavesDoResumo), bold: content.bold.filter((key) => !alvo.has(key)) }));
  }

  /** O intervalo a mesclar: o retângulo marcado, ou a linha/coluna inteira do cabeçalho. */
  function intervaloMarcado() {
    if (!current) return null;
    if (axis) {
      return axis.kind === "row"
        ? rangeOf({ top: axis.index, bottom: axis.index, left: 0, right: current.columns - 1 })
        : rangeOf({ top: 0, bottom: current.rows - 1, left: axis.index, right: axis.index });
    }
    if (avulsas.length || !faixa) return null;
    const a = parseCellKey(faixa.ancora), b = parseCellKey(faixa.foco);
    if (!a || !b) return null;
    return rangeOf({ top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row), left: Math.min(a.column, b.column), right: Math.max(a.column, b.column) });
  }

  function mesclar() {
    if (!current || readOnly) return;
    const range = intervaloMarcado();
    const bounds = range ? boundsOf(range) : null;
    if (!range || !bounds || (bounds.top === bounds.bottom && bounds.left === bounds.right)) {
      toast.error("Marque um retângulo com duas ou mais células para mesclar."); return;
    }
    const ancora = cellKey({ column: bounds.left, row: bounds.top });
    // Como no Excel: só o conteúdo do canto superior esquerdo fica. Avisar antes, porque o
    // resto some da tela (e o desfazer é o único caminho de volta).
    const perdidas = cellsHiddenByMerge(current.content.cells, range);
    if (perdidas.length && !window.confirm(`Mesclar mantém só o conteúdo de ${ancora} e apaga ${perdidas.length} célula(s): ${perdidas.slice(0, 6).join(", ")}${perdidas.length > 6 ? "…" : ""}. Continuar?`)) return;
    aplicar(`Mesclar ${range}`, sheet => {
      const cells = { ...sheet.content.cells };
      for (const key of perdidas) delete cells[key];
      const merges = mergeRange(sheet.content.merges ?? [], range);
      const styles = sheet.content.styles ?? {};
      // Mesclar e centralizar é o uso comum; quem já escolheu alinhamento mantém o seu.
      const centralizado = styles[ancora]?.align ? styles : setStyle(styles, [ancora], "align", "center");
      return { ...sheet, content: { ...sheet.content, cells, merges, styles: centralizado } };
    });
    setAxis(null); setAvulsas([]); setActive(ancora); setFaixa({ ancora, foco: ancora });
  }

  function desmesclar() {
    if (!mesclagemAtiva) return;
    updateContent(`Desfazer mesclagem ${mesclagemAtiva.range}`, content => ({ ...content, merges: unmergeAt(content.merges ?? [], active) }));
  }

  function updateCell(key: string, value: string) {
    aplicar(value.trim() === "" ? `Apagar ${key}` : `Editar ${key}`, (sheet) => {
      const cells = { ...sheet.content.cells };
      if (value.trim() === "") delete cells[key]; else cells[key] = value;
      return { ...sheet, content: { ...sheet.content, cells } };
    });
  }

  async function create(kind: WorksheetKind, templateId?: string) {
    if (!confirmarDescarte()) return;
    try {
      const template = templateId ? worksheetTemplates.find((item) => item.id === templateId) : null;
      const label = template ? template.name
        : kind === "sheet" ? "Planilha" : kind === "document" ? "Documento" : "Saúde financeira";
      const existing = list.filter((item) => item.name === label || item.name.startsWith(`${label} `)).length;
      const name = existing ? `${label} ${existing + 1}` : label;
      const result = await api<{ worksheet: Worksheet }>("/api/worksheets", { method: "POST", body: JSON.stringify({ name, kind, templateId }) });
      await loadList();
      // A permissão vem do servidor, que é quem a aplica. Antes era montada aqui a partir
      // do tipo da planilha — um palpite do navegador sobre o que ele mesmo pode fazer,
      // que divergia do servidor e deixava botão à vista sem efeito.
      await open(result.worksheet.id);
      setDirty(false);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível criar."); }
  }

  async function save() {
    if (!current) return;
    if (issues.size) { toast.error(`Corrija ${issues.size} célula(s) inválida(s) antes de salvar. Consulte as regras de validação.`); return; }
    setSaving(true); setError(""); setConflito(null);
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
      // Conflito era um beco sem saída: a revisão local nunca era atualizada, então toda
      // tentativa seguinte levava o mesmo 409 e a única saída era recarregar e perder
      // tudo. Agora busca-se a versão do servidor e a decisão fica com quem digitou.
      if (cause instanceof ErroDeApi && cause.codigo === "worksheet_conflict") {
        try {
          const atual = await api<{ worksheet: Worksheet }>(`/api/worksheets/${current.id}`);
          setConflito(atual.worksheet);
        } catch {
          setError("Esta planilha mudou em outro acesso e não foi possível ler a versão nova. Baixe o CSV antes de recarregar.");
        }
      } else {
        setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
      }
    } finally { setSaving(false); }
  }

  /** Reenvia o MESMO conteúdo sobre a revisão nova. Decisão explícita de sobrescrever. */
  async function salvarSobreVersaoNova() {
    if (!current || !conflito) return;
    setCurrent({ ...current, revision: conflito.revision });
    setConflito(null);
    setSaving(true); setError("");
    try {
      const result = await api<{ worksheet: Worksheet }>(`/api/worksheets/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: current.name, columns: current.columns, rows: current.rows, content: current.content, revision: conflito.revision }),
      });
      setCurrent(result.worksheet);
      setDirty(false);
      await loadList();
      toast.success("Salvo sobre a versão nova");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally { setSaving(false); }
  }

  /** Desiste do que está na tela e assume a versão do servidor. */
  function usarVersaoDoServidor() {
    if (!conflito) return;
    resetCurrent(conflito);
    setConflito(null);
    setDirty(false);
    toast.success("Versão do servidor carregada");
  }

  async function remove() {
    if (!current || deleting) return;
    if (!window.confirm(`Excluir “${current.name}”? Essa ação não pode ser desfeita.`)) return;
    const deletedId = current.id;
    setDeleting(true); setError("");
    try {
      await api<{ deleted: boolean }>(`/api/worksheets/${deletedId}`, { method: "DELETE" });
      const remaining = await loadList();
      setCurrent(null);
      setAccess(null);
      setDirty(false);
      const next = remaining.find((item) => item.id !== deletedId);
      if (next) await open(next.id);
      toast.success("Planilha excluída");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível excluir.";
      setError(message);
      toast.error(message);
    } finally { setDeleting(false); }
  }

  // Cola a tabela real a partir da célula selecionada, já com a fórmula de total.
  async function insertSource(sourceId: string) {
    if (!current || !sourceId || readOnly) return;
    const anchor = parseCellKey(active) ?? { column: 0, row: 0 };
    try {
      const result = await api<{ headers: string[]; rows: Array<Array<string | number>> }>(
        `/api/worksheets/data?source=${sourceId}&startLine=${anchor.row + 1}`);
      if (!result.rows.length) { toast.info("Não há dados reais para essa origem ainda."); return; }
      if (anchor.column + result.headers.length > SHEET_MAX_COLUMNS || anchor.row + result.rows.length + 1 > SHEET_MAX_ROWS) {
        toast.error("Os dados não cabem a partir desta célula. Escolha uma célula mais acima ou à esquerda."); return;
      }
      aplicar(`Inserir ${result.rows.length} linha(s) de dados`, (sheet) => {
        const cells = { ...sheet.content.cells };
        result.headers.forEach((header, column) => { cells[cellKey({ column: anchor.column + column, row: anchor.row })] = header; });
        result.rows.forEach((row, line) => row.forEach((value, column) => {
          const key = cellKey({ column: anchor.column + column, row: anchor.row + line + 1 });
          cells[key] = typeof value === "number" ? String(value).replace(".", ",") : String(value ?? "");
        }));
        const widest = anchor.column + result.headers.length;
        const tallest = anchor.row + result.rows.length + 1;
        return {
          ...sheet,
          columns: Math.max(sheet.columns, Math.min(SHEET_MAX_COLUMNS, widest)),
          rows: Math.max(sheet.rows, Math.min(SHEET_MAX_ROWS, tallest + 2)),
          content: { ...sheet.content, cells },
        };
      });
      toast.success(`${result.rows.length} linha(s) reais inseridas`);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível trazer os dados."); }
  }

  function insertFunction(name: string) {
    if (!name || !current || readOnly) return;
    const address = parseCellKey(active);
    const rangeFunctions = new Set(["SOMA", "MEDIA", "MIN", "MAX", "CONT.NUM", "CONT.VALORES", "MEDIANA"]);
    if (!axis && selected.length > 1 && rangeFunctions.has(name) && address) {
      // O resultado fica numa célula livre abaixo da seleção, sem substituir
      // uma parcela ou incluir a própria fórmula na soma.
      let row = Math.max(...selected.map((key) => parseCellKey(key)!.row)) + 1;
      while (row < SHEET_MAX_ROWS && current.content.cells[cellKey({ column: address.column, row })]?.trim()) row += 1;
      if (row >= SHEET_MAX_ROWS) { toast.error("Não há célula livre abaixo da seleção para inserir o resultado."); return; }
      const destination = cellKey({ column: address.column, row });
      // Célula e altura numa alteração só: em duas, desfazer uma vez tiraria a fórmula
      // e deixaria a linha extra, e seriam necessários dois cliques para voltar.
      aplicar(`Inserir ${name} em ${destination}`, (sheet) => ({
        ...sheet,
        rows: Math.max(sheet.rows, row + 1),
        content: {
          ...sheet.content,
          cells: { ...sheet.content.cells, [destination]: `=${name}(${selected.join(";")})` },
        },
      }));
      selectCell(destination);
      return;
    }
    // O intervalo segue o eixo selecionado. Antes os dois extremos usavam
    // address.column, então a faixa era sempre vertical e a linha selecionada
    // recebia a soma de uma coluna.
    const target: AxisSelection | null = axis ?? (address ? { kind: "column", index: address.column } : null);
    const until = address ? (target?.kind === "row" ? address.column : address.row) : 0;
    const range = target && rangeFunctions.has(name) ? axisRange(target.kind, target.index, until) : null;
    const suggestion = ["HOJE", "AGORA"].includes(name)
      ? `=${name}()`
      : range ? `=${name}(${range})` : `=${name}(`;
    updateCell(active, suggestion);
    window.requestAnimationFrame(() => {
      formulaRef.current?.focus();
      formulaRef.current?.setSelectionRange(suggestion.length, suggestion.length);
    });
  }

  const sugestoes = useMemo(() => sugestoesDeFuncao(selection?.raw ?? ""), [selection?.raw]);

  function completarFuncao(nome: string) {
    if (!selection || readOnly) return;
    const next = aplicarSugestao(selection.raw, sugestoes.parcial, nome);
    updateCell(active, next);
    window.requestAnimationFrame(() => {
      formulaRef.current?.focus();
      formulaRef.current?.setSelectionRange(next.length, next.length);
    });
  }

  /**
   * Imprime os valores calculados (e o navegador salva em PDF pela mesma janela). Monta um
   * iframe com a tabela via DOM, sem HTML em texto: o conteúdo das células é do usuário e
   * nunca vira marcação.
   */
  function imprimir() {
    if (!current) return;
    const { letras, linhas } = tabelaParaImpressao(computed, current.content.formats, current.content.bold, current.columns, current.rows, current.content.styles ?? {}, current.content.merges ?? []);
    if (!linhas.length) { toast.info("A planilha está vazia. Não há o que imprimir."); return; }
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.append(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) { frame.remove(); toast.error("O navegador não permitiu preparar a impressão."); return; }
    doc.title = current.name;
    const estilo = doc.createElement("style");
    estilo.textContent = "body{font:12px system-ui,sans-serif;margin:16px;color:#111}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 12px;color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}td.b{font-weight:700}td.r{color:#b91c1c}@page{size:landscape;margin:12mm}";
    doc.head.append(estilo);
    const titulo = doc.createElement("h1"); titulo.textContent = current.name;
    const data = doc.createElement("p"); data.textContent = `Revisão ${current.revision} · impresso em ${new Date().toLocaleString("pt-BR")}`;
    const tabela = doc.createElement("table");
    const cabeca = tabela.createTHead().insertRow();
    for (const texto of ["", ...letras]) { const th = doc.createElement("th"); th.textContent = texto; cabeca.append(th); }
    const corpo = tabela.createTBody();
    linhas.forEach((linha, indice) => {
      const tr = corpo.insertRow();
      const numero = doc.createElement("th"); numero.textContent = String(indice + 1); tr.append(numero);
      for (const celula of linha) {
        if (celula.coberta) continue;
        const td = tr.insertCell();
        td.textContent = celula.texto;
        td.className = [celula.numero ? "n" : "", celula.negrito ? "b" : "", celula.negativo ? "r" : ""].filter(Boolean).join(" ");
        if (celula.colSpan > 1) td.colSpan = celula.colSpan;
        if (celula.rowSpan > 1) td.rowSpan = celula.rowSpan;
        Object.assign(td.style, celula.css);
      }
    });
    doc.body.append(titulo, data, tabela);
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    window.setTimeout(() => frame.remove(), 60_000);
    win.focus();
    win.print();
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return normalized ? list.filter((item) => item.name.toLocaleLowerCase("pt-BR").includes(normalized)) : list;
  }, [list, query]);

  if (loading) return <Card><CardContent className="grid min-h-64 place-items-center"><LoaderCircle className="size-6 animate-spin text-hoikos-600" /></CardContent></Card>;

  return <fieldset disabled={saving} className="min-w-0 space-y-5 border-0 p-0">
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
        {list.length ? <NativeSelect aria-label="Abrir" value={current?.id ?? ""} onChange={(event) => { if (confirmarDescarte()) void open(event.target.value); else event.target.value = current?.id ?? ""; }} className="h-9 max-w-[16rem]">
          {filtered.map((item) => <option key={item.id} value={item.id}>{item.kind === "sheet" ? "▦" : "▤"} {item.name}</option>)}
        </NativeSelect> : null}
      </CardContent>
    </Card>

    {conflito ? (
      <Card className="border-hoikos-200">
        <CardContent className="space-y-3 p-4 text-sm text-hoikos-800">
          <p className="flex items-center gap-3 font-medium"><CircleAlert className="size-5 shrink-0" />Esta planilha mudou em outro acesso enquanto você editava</p>
          <p className="text-xs text-hoikos-500">O que você digitou continua aqui na tela e ainda não foi enviado. Escolha o que fazer — nenhuma das opções acontece sozinha.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => void salvarSobreVersaoNova()}>Salvar o meu por cima</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={usarVersaoDoServidor}>Descartar o meu e usar a versão nova</Button>
            <Button size="sm" variant="outline" onClick={() => current && download(`${current.name}.csv`, sheetToCsv(current.content.cells, current.columns, current.rows), "text/csv;charset=utf-8")}>Baixar o meu em CSV</Button>
          </div>
        </CardContent>
      </Card>
    ) : null}
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
            {!readOnly && sources.length ? <NativeSelect aria-label="Inserir dados reais" value="" onChange={(event) => { void insertSource(event.target.value); event.target.value = ""; }} className="h-9">
              <option value="">Inserir dados reais…</option>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
            </NativeSelect> : null}
            <Button size="sm" variant="outline" onClick={() => download(`${current.name}.csv`, sheetToCsv(current.content.cells, current.columns, current.rows), "text/csv;charset=utf-8")}><Download />CSV</Button>
            {readOnly ? null : <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}Salvar</Button>}
            {/* O servidor exige `canDelete`; mostrar o botão sem conferir o mesmo campo
                fazia o colaborador clicar e receber 403 — o "excluir não responde". */}
            {readOnly || !access?.canDelete || (current.visibility === "restricted" && !access?.canGovern) ? null
              : <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label="Excluir" disabled={deleting}>
                  {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}Excluir
                </Button>}
          </div>
        </div>
        {current.kind !== "document" ? <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 rounded-md border border-hoikos-200 bg-hoikos-50 px-2 py-1 text-center font-mono text-xs">{active}</span>
          <Input
            ref={formulaRef} aria-label="Conteúdo da célula" value={selection?.raw ?? ""}
            readOnly={readOnly} onChange={(event) => updateCell(active, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Tab" && !event.shiftKey && sugestoes.funcoes.length) { event.preventDefault(); completarFuncao(sugestoes.funcoes[0]); }
            }}
            placeholder="Digite um valor ou uma fórmula começando por ="
            className="h-9 flex-1 font-mono text-[13px]"
          />
          <NativeSelect aria-label="Inserir função" value="" disabled={readOnly} onChange={(event) => { insertFunction(event.target.value); event.target.value = ""; }} className="h-9 max-w-[11rem]">
            <option value="">Função…</option>
            {SHEET_FUNCTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
          </NativeSelect>
          <span className={`min-w-[6rem] text-right text-sm tabular-nums ${selection?.result?.error ? "text-hoikos-700" : "font-semibold text-hoikos-900"}`}>
            {selection?.result?.display ?? ""}
          </span>
          {!readOnly && sugestoes.funcoes.length ? <div role="group" aria-label="Funções que completam o que você digitou" className="flex w-full flex-wrap items-center gap-1.5 text-xs">
            <span className="text-hoikos-500">Completar com</span>
            {sugestoes.funcoes.map((nome, indice) => <Button key={nome} size="sm" variant="outline" className="h-7 px-2 font-mono text-xs" onClick={() => completarFuncao(nome)}>
              {nome}{indice === 0 ? <span className="ml-1 text-hoikos-500">Tab</span> : null}
            </Button>)}
          </div> : null}
        </div> : null}
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        {current.kind === "document" ? <DocumentEditor
          body={current.content.body}
          cells={current.content.cells}
          readOnly={readOnly}
          onChange={(body) => { updateContent("Editar o texto", (content) => ({ ...content, body })); }}
        /> : (
          <Tabs defaultValue="grade">
            <TabsList>
              <TabsTrigger value="grade">Planilha</TabsTrigger>
              <TabsTrigger value="leitura">Leitura financeira</TabsTrigger>
              {access?.canGovern ? <TabsTrigger value="acesso">Acesso</TabsTrigger> : null}
            </TabsList>

            <TabsContent value="grade" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="Filtrar linhas" placeholder="Filtrar linhas por conteúdo…" value={rowFilter} onChange={event => setRowFilter(event.target.value)} className="max-w-sm" />
                {rowFilter && <Button size="sm" variant="ghost" onClick={() => setRowFilter("")}>Limpar filtro</Button>}
                <Button size="sm" variant="outline" onClick={imprimir}><Printer />Imprimir ou PDF</Button>
              </div>
              {rowFilter && <p className="text-xs text-hoikos-600">O filtro só oculta linhas. Fórmulas e seleções mantêm todas as células, inclusive as ocultas.</p>}
              {!readOnly && <WorksheetToolsPanel key={current.id} cells={current.content.cells} keys={chavesDoResumo} recipes={current.content.recipes ?? []}
                onCells={cells => updateContent(content => ({ ...content, cells }))} onTable={insertTable}
                onRecipes={recipes => updateContent(content => ({ ...content, recipes }))} />}
              <WorksheetAdvancedPanel key={`advanced-${current.id}`} computed={computed} settings={advanced} columns={current.columns} selectedRange={active} readOnly={readOnly}
                onChange={advanced => updateContent("Alterar regras e resumos", content => ({ ...content, advanced }))} onTable={insertTable} />
              <WorksheetXlsxPanel key={`xlsx-${current.id}`} id={current.id} name={current.name} revision={current.revision} dirty={dirty} readOnly={readOnly} onImport={imported => {
                aplicar(`Importar XLSX: ${imported.name}`, sheet => ({ ...sheet, rows: imported.rows, columns: imported.columns, content: { ...sheet.content, cells: imported.cells, formats: {}, widths: {}, bold: imported.bold ?? [], styles: imported.styles ?? {}, merges: imported.merges ?? [], frozenColumns: 0, advanced: emptyAdvanced, analysis: { headerRow: 0, roles: {}, targetMarginPercent: 20, ignoreRows: [] } } }));
                setActive("A1"); setAxis(null); setFaixa({ ancora: "A1", foco: "A1" }); setAvulsas([]); setRowFilter("");
              }} />
              {!readOnly && advanced.validations.filter(rule => rule.kind === "list").map((rule, index) => {
                const start = parseCellKey(rule.range.split(":")[0])!, end = parseCellKey(rule.range.split(":")[1] ?? rule.range)!, address = parseCellKey(active)!;
                return address.row >= start.row && address.row <= end.row && address.column >= start.column && address.column <= end.column ? <NativeSelect key={index} aria-label={`Opções para ${active}`} value="" onChange={event => updateCell(active, event.target.value)}><option value="">Escolher valor para {active}…</option>{rule.options.map(option => <option key={option} value={option}>{option}</option>)}</NativeSelect> : null;
              })}
              {readOnly ? <p className="rounded-md border border-hoikos-200 bg-hoikos-50 px-3 py-2 text-sm text-hoikos-800">
                Seu acesso a esta planilha é somente de leitura.
              </p> : (
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-hoikos-200 bg-hoikos-50 p-2">
                  {/*
                    Desfazer e refazer abrem a barra porque são a saída de todo o resto
                    dela: remover coluna e ordenar são as ações que a pessoa mais erra, e
                    até agora errar significava perder. O título diz O QUE vai voltar —
                    botão que só diz "desfazer" obriga a clicar para descobrir, e
                    descobrir errado é outra perda.
                  */}
                  <Button
                    size="sm" variant="ghost" onClick={desfazerAgora}
                    disabled={!history.canUndo}
                    title={history.undoLabel}
                    aria-label={history.undoLabel}
                  ><Undo2 />Desfazer</Button>
                  <Button
                    size="sm" variant="ghost" onClick={refazerAgora}
                    disabled={!history.canRedo}
                    title={history.redoLabel}
                    aria-label={history.redoLabel}
                  ><Redo2 />Refazer</Button>
                  <span className="mx-1 h-5 w-px bg-hoikos-200" />
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
              {readOnly ? null : <div role="toolbar" aria-label="Formatação do texto" className="flex flex-wrap items-center gap-1.5 rounded-md border border-hoikos-200 bg-white p-2">
                <Toggle size="sm" variant="outline" aria-label="Negrito (Ctrl+B)" title="Negrito (Ctrl+B)" pressed={negritoLigado} onPressedChange={alternarNegrito}><Bold /></Toggle>
                <Toggle size="sm" variant="outline" aria-label="Itálico (Ctrl+I)" title="Itálico (Ctrl+I)" pressed={marcaLigada("italic")} onPressedChange={() => alternarMarca("italic")}><Italic /></Toggle>
                <Toggle size="sm" variant="outline" aria-label="Sublinhado (Ctrl+U)" title="Sublinhado (Ctrl+U)" pressed={marcaLigada("underline")} onPressedChange={() => alternarMarca("underline")}><Underline /></Toggle>
                <Toggle size="sm" variant="outline" aria-label="Tachado" title="Tachado" pressed={marcaLigada("strike")} onPressedChange={() => alternarMarca("strike")}><Strikethrough /></Toggle>
                <span aria-hidden="true" className="mx-1 h-5 w-px bg-hoikos-200" />
                <ToggleGroup type="single" size="sm" variant="outline" aria-label="Alinhamento horizontal" value={alinhamentoAtual}
                  onValueChange={(valor) => definirEstilo("align", (valor || undefined) as CellStyle["align"], valor ? `Alinhar ${valor === "left" ? "à esquerda" : valor === "center" ? "ao centro" : "à direita"}` : "Alinhamento automático")}>
                  <ToggleGroupItem value="left" aria-label="Alinhar à esquerda" title="Alinhar à esquerda"><AlignLeft /></ToggleGroupItem>
                  <ToggleGroupItem value="center" aria-label="Centralizar" title="Centralizar"><AlignCenter /></ToggleGroupItem>
                  <ToggleGroupItem value="right" aria-label="Alinhar à direita" title="Alinhar à direita"><AlignRight /></ToggleGroupItem>
                </ToggleGroup>
                <Toggle size="sm" variant="outline" aria-label="Quebrar texto na célula" title="Quebrar texto na célula" pressed={marcaLigada("wrap")} onPressedChange={() => alternarMarca("wrap")}><WrapText /></Toggle>
                <span aria-hidden="true" className="mx-1 h-5 w-px bg-hoikos-200" />
                <NativeSelect aria-label="Cor do texto" value={valorComum("color")} onChange={event => definirEstilo("color", (event.target.value || undefined) as CellStyle["color"], event.target.value ? `Cor do texto: ${colorLabels[event.target.value]}` : "Cor do texto padrão")}>
                  <option value="">Texto: cor padrão</option>
                  {Object.keys(textColors).map((cor) => <option key={cor} value={cor}>Texto: {colorLabels[cor]}</option>)}
                </NativeSelect>
                <NativeSelect aria-label="Cor de preenchimento" value={valorComum("fill")} onChange={event => definirEstilo("fill", (event.target.value || undefined) as CellStyle["fill"], event.target.value ? `Preenchimento: ${colorLabels[event.target.value]}` : "Sem preenchimento")}>
                  <option value="">Fundo: nenhum</option>
                  {Object.keys(fillColors).map((cor) => <option key={cor} value={cor}>Fundo: {colorLabels[cor]}</option>)}
                </NativeSelect>
                <span aria-hidden="true" className="mx-1 h-5 w-px bg-hoikos-200" />
                <Button size="sm" variant="outline" onClick={mesclar} title="Junta o retângulo marcado numa célula só, centralizada"><TableCellsMerge />Mesclar</Button>
                {mesclagemAtiva ? <Button size="sm" variant="outline" onClick={desmesclar}><TableCellsSplit />Desfazer mesclagem</Button> : null}
                <Button size="sm" variant="ghost" onClick={limparFormatacao}><RemoveFormatting />Limpar formatação</Button>
                <span aria-hidden="true" className="mx-1 h-5 w-px bg-hoikos-200" />
                <NativeSelect aria-label="Formato das colunas selecionadas" value="" onChange={event => {
                  const format = event.target.value;
                  updateContent("Formato da coluna", content => {
                    const formats = { ...content.formats };
                    chavesDoResumo.forEach(key => { const address = parseCellKey(key); if (address) formats[columnName(address.column)] = format; });
                    return { ...content, formats };
                  });
                }}>
                  <option value="">Formato da coluna…</option><option value="texto">Geral</option><option value="numero">Número (2 casas)</option><option value="moeda">Moeda (R$)</option><option value="contabil">Contábil (negativo em vermelho)</option><option value="percentual">Percentual (%)</option>
                </NativeSelect>
                <NativeSelect aria-label="Colunas fixas ao rolar" value={String(current.content.frozenColumns ?? 0)} onChange={event => {
                  const frozenColumns = Number(event.target.value);
                  updateContent(frozenColumns ? `Fixar ${frozenColumns === 1 ? "a coluna A" : "as colunas A e B"}` : "Soltar colunas fixas", content => ({ ...content, frozenColumns }));
                }}>
                  <option value="0">Sem colunas fixas</option><option value="1">Fixar coluna A</option><option value="2">Fixar colunas A e B</option>
                </NativeSelect>
              </div>}
              <Grid
                colors={colors} issues={issues}
                formats={current.content.formats} bold={current.content.bold} widths={current.content.widths} filter={rowFilter} readOnly={readOnly}
                onCopyCells={() => selectionToTsv(current.content.cells, chavesDoResumo)}
                cells={current.content.cells} columns={current.columns} rows={current.rows}
                computed={computed} active={active} selected={selectedSet} axis={axis}
                onActive={selectCell} onEstender={estenderAte} onAxis={selectAxis} onChange={updateCell}
                onColar={colar} onDesfazer={desfazerAgora} onRefazer={refazerAgora}
                frozen={Math.min(current.content.frozenColumns ?? 0, current.columns)}
                styles={estilos} merges={mesclagens} onFormatar={formatarAtalho}
                onWidth={(column, width) => updateContent(`Largura da coluna ${columnName(column)}`, (content) => ({ ...content, widths: { ...content.widths, [columnName(column)]: width } }))}
              />
              {/*
                A barra de resumo. Antes era uma frase de ajuda com uma soma grudada no
                fim, que depois de qualquer clique dizia "Soma da seleção (1 células)":
                plural errado, número que a barra de fórmulas já mostrava, e que derrubava
                o "Total da coluna" — a leitura que interessa num orçamento.
                `aria-live` porque a soma é o propósito da tela e mudava em silêncio.
              */}
              <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-hoikos-200 bg-hoikos-50 px-3 py-2 text-xs text-hoikos-700">
                <span className="font-mono">
                  {axis
                    ? (axis.kind === "row" ? `Linha ${axis.index + 1}` : `Coluna ${columnName(axis.index)}`)
                    : faixa ? rotuloDoRetangulo(faixa.ancora, faixa.foco) : active}
                </span>
                {axis ? <span>Total <strong className="tabular-nums">{displayValue(axisSum.total)}</strong></span> : null}
                {!axis && resumo.celulas <= 1 ? (
                  // Uma célula só: o valor dela já está na barra de fórmulas logo acima.
                  // Repeti-lo aqui era o velho "Soma da seleção (1 células)" — e ele
                  // derrubava o total da coluna, que é a leitura que falta na tela.
                  <span>Total da coluna {columnName(axisSum.index)} <strong className="tabular-nums">{displayValue(axisSum.total)}</strong></span>
                ) : null}
                {resumo.celulas > 1 ? <span>Preenchidas <strong className="tabular-nums">{resumo.preenchidas}</strong></span> : null}
                {resumo.celulas > 1 && resumo.soma !== null ? (
                  <>
                    {axis ? null : <span>Soma <strong className="tabular-nums">{displayValue(resumo.soma)}</strong></span>}
                    <span>Média <strong className="tabular-nums">{displayValue(arredondarExibicao(resumo.media))}</strong></span>
                    <span>Mín <strong className="tabular-nums">{displayValue(resumo.minimo)}</strong></span>
                    <span>Máx <strong className="tabular-nums">{displayValue(resumo.maximo)}</strong></span>
                    {resumo.numericas !== resumo.preenchidas ? <span className="text-hoikos-500">{resumo.numericas} numéricas</span> : null}
                  </>
                ) : null}
                {resumo.celulas > 1 && resumo.soma === null ? (
                  // Nunca exibir "Soma 0" aqui: zero se lê como zero de verdade.
                  <span className="text-hoikos-500">{resumo.preenchidas ? "sem número para somar" : "nenhuma célula preenchida"}</span>
                ) : null}
                {resumo.comErro ? <span className="font-medium">{resumo.comErro} com erro, fora das contas</span> : null}
              </div>
              <details className="text-xs leading-5 text-hoikos-500">
                <summary className="cursor-pointer">Atalhos</summary>
                <p className="mt-1">
                  Enter ou F2 edita, setas navegam, Tab anda na linha, Delete limpa. Arraste com o mouse ou use
                  Shift + clique e Shift + setas para marcar um intervalo. Clique no cabeçalho para selecionar a linha
                  ou a coluna inteira. Ctrl + clique (ou ⌘ + clique) adiciona ou remove células avulsas.
                  Ctrl + C copia os valores selecionados; Ctrl + V cola tabelas do Excel ou Google Planilhas a partir da célula ativa.
                  Referências como $A$1 ficam fixas ao preencher para baixo. Marque um intervalo para preencher cada coluna dele a partir da primeira linha.
                  Ctrl + B, Ctrl + I e Ctrl + U aplicam negrito, itálico e sublinhado ao que está marcado. Mesclar mantém só o conteúdo do canto superior esquerdo.
                </p>
              </details>
            </TabsContent>

            <TabsContent value="leitura" className="mt-4">
              <AnalysisPanel
                cells={current.content.cells} columns={current.columns} rows={current.rows}
                settings={current.content.analysis} canEdit={!readOnly}
                onChange={(analysis) => updateContent("Alterar a leitura financeira", (content) => ({ ...content, analysis }))}
              />
            </TabsContent>

            {access?.canGovern ? <TabsContent value="acesso" className="mt-4"><GrantsPanel worksheetId={current.id} /></TabsContent> : null}
          </Tabs>
        )}
      </CardContent>
    </Card>}
  </fieldset>;
}

// O documento aceita os mesmos cálculos: {{=SOMA(A1:A9)}} vira o número já somado.
function DocumentEditor({ body, cells, onChange, readOnly }: { body: string; cells: SheetCells; onChange: (body: string) => void; readOnly: boolean }) {
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
        id="document-body" value={body} readOnly={readOnly} onChange={(event) => onChange(event.target.value)}
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
