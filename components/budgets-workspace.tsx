"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BookCopy,
  Calculator,
  Check,
  ChevronRight,
  CircleAlert,
  FileSpreadsheet,
  LibraryBig,
  LoaderCircle,
  PackagePlus,
  Plus,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Project = { id: string; code: string; name: string; kind: "project" | "work" };
type Budget = {
  id: string; projectId: string; projectName: string | null; code: string; version: number;
  status: string; directCostCents: number; bdiPercent: number; marginPercent: number;
  totalCents: number; itemCount: number; updatedAt: string;
};
type BudgetItem = {
  id: string; code: string | null; description: string; unit: string; quantity: number;
  unitCostCents: number; unitPriceCents: number; source: string; totalCents: number;
};
type CatalogItem = {
  id: string; code: string; description: string; category: string; unit: string;
  unitCostCents: number; defaultUnitPriceCents: number | null; source: string;
};
type SinapiItem = {
  code: string; description: string; unit: string; unitCostCents: number;
  referenceMonth: string; state: string; sourceReference: string;
};
type DraftItem = {
  code: string | null; description: string; unit: string; quantity: number;
  unitCostCents: number; unitPriceCents: number | null; source: "manual" | "library" | "sinapi";
  sourceReference?: string | null;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const statusLabels: Record<string, string> = { draft: "Rascunho", sent: "Enviado", approved: "Aprovado", rejected: "Recusado", archived: "Arquivado" };

class RequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new RequestError(body.error ?? "Não foi possível concluir a operação.", body.code);
  return body;
}

function moneyToCents(value: FormDataEntryValue | string | null) {
  const raw = String(value ?? "").trim().replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function numberValue(value: FormDataEntryValue | string | null, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBulk(text: string): DraftItem[] {
  const items: DraftItem[] = [];
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
    const separator = line.includes("\t") ? "\t" : ";";
    const [code, description, unit = "un", quantity = "1", cost = "0", price = ""] = line.split(separator).map((cell) => cell.trim());
    if (index === 0 && /descri[cç][aã]o/i.test(description ?? "")) return;
    if (!description || description.length < 2) return;
    items.push({ code: code || null, description, unit: unit || "un", quantity: Math.max(0.0001, numberValue(quantity, 1)), unitCostCents: moneyToCents(cost), unitPriceCents: price ? moneyToCents(price) : null, source: "manual" });
  });
  return items.slice(0, 200);
}

function BudgetStatus({ status }: { status: string }) {
  const color = status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "rejected" ? "border-red-200 bg-red-50 text-red-700" : status === "sent" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600";
  return <Badge variant="outline" className={color}>{statusLabels[status] ?? status}</Badge>;
}

export function BudgetsWorkspace({ projects, query, canEdit }: { projects: Project[]; query: string; canEdit: boolean }) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [library, setLibrary] = useState<CatalogItem[]>([]);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState("");
  const [newBudgetOpen, setNewBudgetOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sinapiOpen, setSinapiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [saveInLibrary, setSaveInLibrary] = useState(false);
  const [sinapiItems, setSinapiItems] = useState<SinapiItem[]>([]);
  const [sinapiMessage, setSinapiMessage] = useState("");
  const [sinapiLoading, setSinapiLoading] = useState(false);

  const selected = budgets.find((budget) => budget.id === selectedId) ?? null;

  const loadBase = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [budgetData, libraryData] = await Promise.all([
        requestJson<{ budgets: Budget[] }>("/api/budgets"),
        requestJson<{ items: CatalogItem[] }>("/api/budget-library"),
      ]);
      setBudgets(budgetData.budgets); setLibrary(libraryData.items);
      setSelectedId((current) => current && budgetData.budgets.some((budget) => budget.id === current) ? current : budgetData.budgets[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os orçamentos."); }
    finally { setLoading(false); }
  }, []);

  const loadItems = useCallback(async (budgetId: string) => {
    setItemsLoading(true);
    try { setItems((await requestJson<{ items: BudgetItem[] }>(`/api/budgets/${budgetId}/items`)).items); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível carregar os itens."); }
    finally { setItemsLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadBase(), 0); return () => window.clearTimeout(timer); }, [loadBase]);
  useEffect(() => { if (!selectedId) return; const timer = window.setTimeout(() => void loadItems(selectedId), 0); return () => window.clearTimeout(timer); }, [loadItems, selectedId]);

  const filteredBudgets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return budgets.filter((budget) => !normalized || `${budget.code} ${budget.projectName ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized));
  }, [budgets, query]);
  const filteredLibrary = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return library.filter((item) => !normalized || `${item.code} ${item.description} ${item.category}`.toLocaleLowerCase("pt-BR").includes(normalized));
  }, [library, query]);
  const bulkItems = useMemo(() => parseBulk(bulkText), [bulkText]);

  async function createBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await requestJson<{ budget: Budget }>("/api/budgets", { method: "POST", body: JSON.stringify({ projectId: data.get("projectId"), code: data.get("code"), bdiPercent: numberValue(data.get("bdiPercent")), marginPercent: numberValue(data.get("marginPercent")) }) });
      toast.success("Orçamento criado", { description: `${result.budget.code} · versão ${result.budget.version}` });
      setNewBudgetOpen(false); await loadBase(); setSelectedId(result.budget.id);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível criar o orçamento."); }
    finally { setSaving(false); }
  }

  async function addItems(nextItems: DraftItem[]) {
    if (!selected || nextItems.length === 0) return;
    setSaving(true);
    try {
      const result = await requestJson<{ items: BudgetItem[] }>(`/api/budgets/${selected.id}/items`, { method: "POST", body: JSON.stringify({ items: nextItems }) });
      setItems(result.items); await loadBase(); toast.success(nextItems.length === 1 ? "Item adicionado" : `${nextItems.length} itens importados`);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível adicionar os itens."); throw cause; }
    finally { setSaving(false); }
  }

  async function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const item: DraftItem = { code: String(data.get("code") || "") || null, description: String(data.get("description") || ""), unit: String(data.get("unit") || "un"), quantity: numberValue(data.get("quantity"), 1), unitCostCents: moneyToCents(data.get("unitCost")), unitPriceCents: data.get("unitPrice") ? moneyToCents(data.get("unitPrice")) : null, source: "manual" };
    try {
      await addItems([item]);
      if (saveInLibrary && item.code) {
        await requestJson("/api/budget-library", { method: "POST", body: JSON.stringify({ code: item.code, description: item.description, unit: item.unit, category: String(data.get("category") || "Geral"), unitCostCents: item.unitCostCents, defaultUnitPriceCents: item.unitPriceCents }) }).then(() => loadBase()).catch((cause: Error) => toast.warning("Item incluído no orçamento, mas não salvo na biblioteca.", { description: cause.message }));
      }
      setItemOpen(false); setSaveInLibrary(false);
    } catch { /* addItems already reports the error */ }
  }

  async function createLibraryItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      await requestJson("/api/budget-library", { method: "POST", body: JSON.stringify({ code: data.get("code"), description: data.get("description"), category: data.get("category"), unit: data.get("unit"), unitCostCents: moneyToCents(data.get("unitCost")), defaultUnitPriceCents: data.get("unitPrice") ? moneyToCents(data.get("unitPrice")) : null }) });
      toast.success("Item salvo na biblioteca"); setLibraryOpen(false); await loadBase();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar o item."); }
    finally { setSaving(false); }
  }

  async function updateStatus(status: "sent" | "approved") {
    if (!selected) return;
    try { await requestJson(`/api/budgets/${selected.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await loadBase(); toast.success(status === "sent" ? "Orçamento marcado como enviado" : "Orçamento aprovado"); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível atualizar o orçamento."); }
  }

  async function searchSinapi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSinapiLoading(true); setSinapiMessage(""); setSinapiItems([]);
    const data = new FormData(event.currentTarget);
    try {
      const params = new URLSearchParams({ q: String(data.get("q")), uf: String(data.get("uf")), referenceMonth: String(data.get("referenceMonth")) });
      const result = await requestJson<{ items: SinapiItem[] }>(`/api/integrations/sinapi/items?${params}`);
      setSinapiItems(result.items); if (!result.items.length) setSinapiMessage("Nenhum item encontrado para esses filtros.");
    } catch (cause) { setSinapiMessage(cause instanceof Error ? cause.message : "Não foi possível consultar a SINAPI."); }
    finally { setSinapiLoading(false); }
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  if (loading) return <Card><Empty className="min-h-72 border-0"><LoaderCircle className="size-7 animate-spin text-blue-600" /><p className="text-sm text-slate-500">Carregando orçamentos…</p></Empty></Card>;
  if (error) return <Card><Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon"><CircleAlert /></EmptyMedia><EmptyTitle>Não foi possível carregar</EmptyTitle><EmptyDescription>{error}</EmptyDescription></EmptyHeader><Button onClick={() => void loadBase()}>Tentar novamente</Button></Empty></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Empresa atual</p><h1 className="display-heading mt-2 text-3xl font-semibold text-slate-950">Orçamentos</h1><p className="mt-2 text-sm text-slate-500">Versões, composições e preços padronizados por projeto.</p></div>{canEdit ? <Button onClick={() => setNewBudgetOpen(true)} disabled={!projects.length} className="rounded-xl"><Plus />Novo orçamento</Button> : null}</div>

      <Tabs defaultValue="budgets">
        <TabsList className="rounded-xl"><TabsTrigger value="budgets"><Calculator />Orçamentos</TabsTrigger><TabsTrigger value="library"><LibraryBig />Biblioteca <Badge variant="secondary">{library.length}</Badge></TabsTrigger></TabsList>
        <TabsContent value="budgets" className="mt-5">
          {!budgets.length ? <Card><Empty className="min-h-80 border-0"><EmptyHeader><EmptyMedia variant="icon" className="bg-blue-50 text-blue-700"><Calculator /></EmptyMedia><EmptyTitle>Nenhum orçamento criado</EmptyTitle><EmptyDescription>{projects.length ? "Crie a primeira versão e adicione itens manualmente, pela biblioteca ou em lote." : "Cadastre um projeto ou obra antes de iniciar o orçamento."}</EmptyDescription></EmptyHeader>{canEdit && projects.length ? <Button onClick={() => setNewBudgetOpen(true)}><Plus />Criar orçamento</Button> : null}</Empty></Card> : <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]"><Card className="h-fit overflow-hidden"><CardHeader className="border-b bg-slate-50/70"><CardTitle className="text-base">Versões</CardTitle></CardHeader><CardContent className="p-2">{filteredBudgets.map((budget) => <button key={budget.id} onClick={() => setSelectedId(budget.id)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${selectedId === budget.id ? "bg-blue-50 text-blue-950" : "hover:bg-slate-50"}`}><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${selectedId === budget.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}><BookCopy className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{budget.code} · v{budget.version}</span><span className="block truncate text-xs text-slate-500">{budget.projectName}</span></span><ChevronRight className="size-4 text-slate-400" /></button>)}</CardContent></Card>{selected ? <Card className="overflow-hidden"><CardHeader className="border-b bg-white"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><CardTitle>{selected.code} · versão {selected.version}</CardTitle><BudgetStatus status={selected.status} /></div><p className="mt-2 text-sm text-slate-500">{selected.projectName} · BDI {selected.bdiPercent}% · margem {selected.marginPercent}%</p></div>{canEdit ? <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setBulkOpen(true)}><FileSpreadsheet />Importar em lote</Button><Button variant="outline" onClick={() => setSinapiOpen(true)}><Search />SINAPI</Button><Button onClick={() => setItemOpen(true)}><Plus />Adicionar item</Button></div> : null}</div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Summary label="Custo direto" value={currency.format(selected.directCostCents / 100)} /><Summary label="Preço total" value={currency.format(selected.totalCents / 100)} highlight /><Summary label="Itens / quantidade" value={`${selected.itemCount} / ${totalQuantity.toLocaleString("pt-BR")}`} /></div></CardHeader><CardContent className="p-0">{itemsLoading ? <div className="grid min-h-56 place-items-center"><LoaderCircle className="animate-spin text-blue-600" /></div> : items.length ? <><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="pl-5">Item</TableHead><TableHead>Un.</TableHead><TableHead className="text-right">Qtd.</TableHead><TableHead className="text-right">Custo un.</TableHead><TableHead className="text-right">Preço un.</TableHead><TableHead className="pr-5 text-right">Total</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.id}><TableCell className="pl-5"><p className="font-medium text-slate-900">{item.description}</p><p className="text-xs text-slate-500">{item.code || "Sem código"} · {item.source === "sinapi" ? "SINAPI" : item.source === "library" ? "Biblioteca" : "Manual"}</p></TableCell><TableCell>{item.unit}</TableCell><TableCell className="text-right tabular-nums">{item.quantity.toLocaleString("pt-BR")}</TableCell><TableCell className="text-right tabular-nums">{currency.format(item.unitCostCents / 100)}</TableCell><TableCell className="text-right tabular-nums">{currency.format(item.unitPriceCents / 100)}</TableCell><TableCell className="pr-5 text-right font-semibold tabular-nums">{currency.format(item.totalCents / 100)}</TableCell></TableRow>)}</TableBody></Table></div>{canEdit && selected.status === "draft" ? <div className="flex flex-wrap justify-end gap-2 border-t bg-slate-50 px-5 py-4"><Button variant="outline" onClick={() => void updateStatus("sent")}><Send />Marcar como enviado</Button><Button onClick={() => void updateStatus("approved")}><Check />Aprovar orçamento</Button></div> : null}</> : <Empty className="min-h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><PackagePlus /></EmptyMedia><EmptyTitle>Versão sem itens</EmptyTitle><EmptyDescription>Adicione um item, use sua biblioteca ou cole uma planilha.</EmptyDescription></EmptyHeader>{canEdit ? <Button onClick={() => setItemOpen(true)}><Plus />Adicionar primeiro item</Button> : null}</Empty>}</CardContent></Card> : null}</div>}
        </TabsContent>
        <TabsContent value="library" className="mt-5"><Card><CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><LibraryBig className="size-5 text-blue-600" />Biblioteca da empresa</CardTitle><p className="mt-2 text-sm text-slate-500">Produtos e serviços reutilizáveis em novos orçamentos.</p></div>{canEdit ? <Button onClick={() => setLibraryOpen(true)}><Plus />Novo item</Button> : null}</div></CardHeader><CardContent>{filteredLibrary.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredLibrary.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><Badge variant="outline">{item.category}</Badge><p className="mt-3 font-semibold text-slate-900">{item.description}</p><p className="mt-1 text-xs text-slate-500">{item.code} · {item.unit}</p></div><p className="text-right text-sm font-semibold tabular-nums">{currency.format((item.defaultUnitPriceCents ?? item.unitCostCents) / 100)}</p></div>{canEdit && selected ? <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => void addItems([{ code: item.code, description: item.description, unit: item.unit, quantity: 1, unitCostCents: item.unitCostCents, unitPriceCents: item.defaultUnitPriceCents, source: "library", sourceReference: item.id }])}><Plus />Usar no orçamento selecionado</Button> : null}</div>)}</div> : <Empty className="min-h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><LibraryBig /></EmptyMedia><EmptyTitle>Biblioteca vazia</EmptyTitle><EmptyDescription>Cadastre os itens usados pela empresa para padronizar descrições e preços.</EmptyDescription></EmptyHeader>{canEdit ? <Button onClick={() => setLibraryOpen(true)}><Plus />Cadastrar item</Button> : null}</Empty>}</CardContent></Card></TabsContent>
      </Tabs>

      <Dialog open={newBudgetOpen} onOpenChange={setNewBudgetOpen}><DialogContent><DialogHeader><DialogTitle>Novo orçamento</DialogTitle><DialogDescription>A versão é numerada automaticamente quando o código já existe.</DialogDescription></DialogHeader><form onSubmit={createBudget} className="space-y-4"><Field name="code" label="Código do orçamento" placeholder="ORC-001" required /><div><label className="mb-1.5 block text-sm font-medium">Projeto ou obra</label><Select name="projectId" required><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-4"><Field name="bdiPercent" label="BDI (%)" type="number" defaultValue="0" step="0.01" /><Field name="marginPercent" label="Margem (%)" type="number" defaultValue="0" step="0.01" /></div><Button type="submit" disabled={saving} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Criar versão</Button></form></DialogContent></Dialog>
      <Dialog open={itemOpen} onOpenChange={setItemOpen}><DialogContent><DialogHeader><DialogTitle>Adicionar item</DialogTitle><DialogDescription>Se o preço ficar vazio, o sistema calcula custo + BDI + margem desta versão.</DialogDescription></DialogHeader><form onSubmit={addManual} className="space-y-4"><div className="grid grid-cols-[1fr_2fr] gap-4"><Field name="code" label="Código" /><Field name="description" label="Descrição" required /></div><div className="grid grid-cols-3 gap-4"><Field name="unit" label="Unidade" defaultValue="un" required /><Field name="quantity" label="Quantidade" type="number" defaultValue="1" step="0.0001" required /><Field name="category" label="Categoria" defaultValue="Geral" /></div><div className="grid grid-cols-2 gap-4"><Field name="unitCost" label="Custo unitário (R$)" placeholder="0,00" /><Field name="unitPrice" label="Preço unitário (R$)" placeholder="Automático" /></div><label className="flex items-center gap-3 rounded-xl border bg-slate-50 p-3 text-sm"><Checkbox checked={saveInLibrary} onCheckedChange={(value) => setSaveInLibrary(value === true)} />Salvar também na biblioteca da empresa</label><Button type="submit" disabled={saving} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <Plus />}Adicionar</Button></form></DialogContent></Dialog>
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Importar itens em lote</DialogTitle><DialogDescription>Cole linhas separadas por ponto e vírgula ou tabulação: código; descrição; unidade; quantidade; custo; preço.</DialogDescription></DialogHeader><div className="space-y-4"><Input type="file" accept=".csv,text/csv,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setBulkText); }} /><Textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} rows={10} placeholder={"COD-01;Serviço ou produto;m²;10;25,50;39,90\nCOD-02;Outro item;un;2;100,00;150,00"} className="font-mono text-sm" /><div className="flex items-center justify-between rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><span>{bulkItems.length} item(ns) válido(s) identificado(s)</span><span>Limite: 200</span></div><Button onClick={() => void addItems(bulkItems).then(() => { setBulkOpen(false); setBulkText(""); }).catch(() => undefined)} disabled={saving || !bulkItems.length} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}Importar itens</Button></div></DialogContent></Dialog>
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}><DialogContent><DialogHeader><DialogTitle>Novo item da biblioteca</DialogTitle><DialogDescription>Use códigos e descrições padronizados pela sua empresa.</DialogDescription></DialogHeader><form onSubmit={createLibraryItem} className="space-y-4"><div className="grid grid-cols-2 gap-4"><Field name="code" label="Código" required /><Field name="category" label="Categoria" defaultValue="Geral" required /></div><Field name="description" label="Descrição" required /><div className="grid grid-cols-3 gap-4"><Field name="unit" label="Unidade" defaultValue="un" required /><Field name="unitCost" label="Custo (R$)" /><Field name="unitPrice" label="Preço (R$)" /></div><Button type="submit" disabled={saving} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar item</Button></form></DialogContent></Dialog>
      <Dialog open={sinapiOpen} onOpenChange={setSinapiOpen}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Buscar na SINAPI</DialogTitle><DialogDescription>A consulta usa apenas a fonte oficial configurada para a plataforma e mantém UF e competência no vínculo.</DialogDescription></DialogHeader><form onSubmit={searchSinapi} className="grid gap-3 sm:grid-cols-[1fr_90px_150px_auto]"><Input name="q" placeholder="Código ou descrição" minLength={2} required /><Input name="uf" placeholder="UF" defaultValue="SP" maxLength={2} required /><Input name="referenceMonth" type="month" defaultValue={new Date().toISOString().slice(0, 7)} required /><Button type="submit" disabled={sinapiLoading}>{sinapiLoading ? <LoaderCircle className="animate-spin" /> : <Search />}Buscar</Button></form>{sinapiMessage ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="flex items-center gap-2 font-medium"><CircleAlert className="size-4" />{sinapiMessage}</p><p className="mt-2 text-xs leading-5 text-amber-800">Nenhum preço demonstrativo será usado no lugar da base oficial.</p></div> : null}<div className="max-h-[45svh] space-y-2 overflow-y-auto">{sinapiItems.map((item) => <div key={item.sourceReference} className="flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Sparkles className="size-4" /></span><div className="min-w-0 flex-1"><p className="font-medium">{item.description}</p><p className="text-xs text-slate-500">{item.code} · {item.unit} · {item.state} · {item.referenceMonth}</p></div><p className="font-semibold tabular-nums">{currency.format(item.unitCostCents / 100)}</p><Button size="sm" onClick={() => void addItems([{ code: item.code, description: item.description, unit: item.unit, quantity: 1, unitCostCents: item.unitCostCents, unitPriceCents: null, source: "sinapi", sourceReference: item.sourceReference }])}><Plus />Adicionar</Button></div>)}</div></DialogContent></Dialog>
    </div>
  );
}

function Summary({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${highlight ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`metric-number mt-2 text-xl font-semibold ${highlight ? "text-blue-900" : "text-slate-900"}`}>{value}</p></div>;
}

function Field({ name, label, type = "text", placeholder, required, defaultValue, step }: { name: string; label: string; type?: string; placeholder?: string; required?: boolean; defaultValue?: string; step?: string }) {
  return <div><label htmlFor={`budget-${name}`} className="mb-1.5 block text-sm font-medium">{label}</label><Input id={`budget-${name}`} name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} step={step} min={type === "number" ? "0" : undefined} /></div>;
}
