"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  Building2,
  Check,
  CircleAlert,
  CircleDollarSign,
  Clipboard,
  Download,
  Landmark,
  Link2,
  LoaderCircle,
  Plus,
  Send,
  Settings2,
  WalletCards,
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

type Project = {
  id: string; code: string; name: string; kind: "project" | "work";
  externalFinancialCostCenterId?: string | null;
};
type Connection = { id: string; externalCompanyId: string; status: string; lastSyncedAt: string | null; lastError: string | null };
type Capabilities = { summary: boolean; transactions: boolean; charges: boolean };
type FinancialSummary = { currentBalance: number; receivables: number; payables: number; projected30d: number; overdueReceivables: number; updatedAt: string; source: "drap" };
type Transaction = {
  id: string; type: "receivable" | "payable"; description: string; amount: number;
  dueDate: string | null; paidAt: string | null; status: "open" | "overdue" | "paid" | "cancelled";
  partyName: string | null; costCenterId: string | null;
};
type Charge = {
  id: string; projectId: string; projectName: string; clientName: string | null; description: string;
  amountCents: number; dueDate: string; reminders: { daysBefore?: number; onDueDate?: boolean; overdueIntervalDays?: number };
  status: string; externalChargeId: string | null; shareUrl: string | null; lastError: string | null; createdAt: string;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const transactionStatus: Record<string, string> = { open: "Em aberto", overdue: "Vencido", paid: "Pago", cancelled: "Cancelado" };

class RequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new RequestError(body.error ?? "Não foi possível concluir a operação.", body.code);
  return body;
}

function moneyToCents(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/R\$\s?/i, "").replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function formatDate(value: string | null) {
  if (!value) return "Sem data";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "paid" || status === "created" || status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "overdue" || status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700";
  return <Badge variant="outline" className={color}>{transactionStatus[status] ?? (status === "failed" ? "Falhou" : status === "pending" ? "Processando" : status)}</Badge>;
}

export function FinanceWorkspace({ projects, query, canEdit, canManageConnection, onProjectsChanged }: { projects: Project[]; query: string; canEdit: boolean; canManageConnection: boolean; onProjectsChanged: () => Promise<void> }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({ summary: false, transactions: false, charges: false });
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [scopeProjectId, setScopeProjectId] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [flowLoading, setFlowLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [remindOnDueDate, setRemindOnDueDate] = useState(true);

  const loadBase = useCallback(async () => {
    setLoading(true); setMessage("");
    try {
      const [connectionResult, summaryResult, chargeResult] = await Promise.all([
        requestJson<{ connection: Connection | null; capabilities: Capabilities }>("/api/integrations/drap/connection"),
        requestJson<FinancialSummary>("/api/integrations/drap/summary").then((value) => ({ value, error: "" })).catch((cause: Error) => ({ value: null, error: cause.message })),
        requestJson<{ charges: Charge[] }>("/api/integrations/drap/charges"),
      ]);
      setConnection(connectionResult.connection); setCapabilities(connectionResult.capabilities);
      setSummary(summaryResult.value); setMessage(summaryResult.error); setCharges(chargeResult.charges);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Não foi possível carregar o financeiro."); }
    finally { setLoading(false); }
  }, []);

  const loadTransactions = useCallback(async (projectId: string) => {
    if (!connection || !capabilities.transactions) { setTransactions([]); return; }
    setFlowLoading(true);
    try {
      const suffix = projectId === "all" ? "" : `?projectId=${encodeURIComponent(projectId)}`;
      setTransactions((await requestJson<{ transactions: Transaction[] }>(`/api/integrations/drap/transactions${suffix}`)).transactions);
    } catch (cause) { setTransactions([]); setMessage(cause instanceof Error ? cause.message : "Não foi possível consultar as contas."); }
    finally { setFlowLoading(false); }
  }, [capabilities.transactions, connection]);

  useEffect(() => { const timer = window.setTimeout(() => void loadBase(), 0); return () => window.clearTimeout(timer); }, [loadBase]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestedProject = new URLSearchParams(window.location.search).get("project");
      if (requestedProject && projects.some((project) => project.id === requestedProject)) setScopeProjectId(requestedProject);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [projects]);
  useEffect(() => { const timer = window.setTimeout(() => void loadTransactions(scopeProjectId), 0); return () => window.clearTimeout(timer); }, [loadTransactions, scopeProjectId]);

  const selectedProject = projects.find((project) => project.id === scopeProjectId) ?? null;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return transactions.filter((item) => (typeFilter === "all" || item.type === typeFilter) && (statusFilter === "all" || item.status === statusFilter) && (!normalized || `${item.description} ${item.partyName ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized)));
  }, [query, statusFilter, transactions, typeFilter]);

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const data = new FormData(event.currentTarget);
    try { await requestJson("/api/integrations/drap/connection", { method: "PUT", body: JSON.stringify({ externalCompanyId: data.get("externalCompanyId") }) }); toast.success("Empresa vinculada à Drap"); setSettingsOpen(false); await loadBase(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar a conexão."); }
    finally { setSaving(false); }
  }

  async function saveProjectLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      await requestJson("/api/integrations/drap/project-link", { method: "POST", body: JSON.stringify({ projectId: data.get("projectId"), externalCostCenterId: data.get("externalCostCenterId"), externalCustomerId: data.get("externalCustomerId") || null }) });
      toast.success("Centro de custo vinculado"); setLinkOpen(false); void onProjectsChanged();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível vincular a obra."); }
    finally { setSaving(false); }
  }

  async function createCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await requestJson<{ charge: Charge }>("/api/integrations/drap/charges", { method: "POST", body: JSON.stringify({ projectId: data.get("projectId"), description: data.get("description"), amountCents: moneyToCents(data.get("amount")), dueDate: data.get("dueDate"), idempotencyKey: crypto.randomUUID(), reminders: { daysBefore: Number(data.get("daysBefore") || 0), onDueDate: remindOnDueDate, overdueIntervalDays: Number(data.get("overdueIntervalDays") || 0) } }) });
      toast.success("Cobrança confirmada pela Drap"); setChargeOpen(false); await loadBase();
      if (result.charge.shareUrl) await navigator.clipboard.writeText(result.charge.shareUrl).then(() => toast.success("Link da cobrança copiado"));
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível criar a cobrança."); }
    finally { setSaving(false); }
  }

  function exportCsv() {
    const lines = [["tipo", "descrição", "parte", "vencimento", "situação", "valor"], ...filtered.map((item) => [item.type === "receivable" ? "receber" : "pagar", item.description, item.partyName ?? "", item.dueDate ?? "", transactionStatus[item.status] ?? item.status, item.amount.toFixed(2).replace(".", ",")])];
    const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `financeiro-${scopeProjectId === "all" ? "empresa" : selectedProject?.code ?? "obra"}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <Card><Empty className="min-h-72 border-0"><LoaderCircle className="size-7 animate-spin text-blue-600" /><p className="text-sm text-slate-500">Consultando a fonte financeira…</p></Empty></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Empresa atual</p><h1 className="display-heading mt-2 text-3xl font-semibold text-slate-950">Financeiro</h1><p className="mt-2 text-sm text-slate-500">Contas, cobranças e resultado no contexto de cada obra.</p></div><div className="flex flex-wrap gap-2">{canManageConnection ? <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 />Conexão Drap</Button> : null}{canEdit ? <Button onClick={() => setChargeOpen(true)} disabled={!connection || !capabilities.charges}><Plus />Nova cobrança</Button> : null}</div></div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Saldo atual" value={summary ? currency.format(summary.currentBalance) : "Indisponível"} icon={Landmark} tone="blue" />
        <Metric label="A receber" value={summary ? currency.format(summary.receivables) : "Indisponível"} icon={ArrowDownLeft} tone="emerald" />
        <Metric label="A pagar" value={summary ? currency.format(summary.payables) : "Indisponível"} icon={ArrowUpRight} tone="amber" />
        <Metric label="Projeção 30 dias" value={summary ? currency.format(summary.projected30d) : "Indisponível"} icon={WalletCards} tone="blue" />
      </div>

      {message ? <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center"><CircleAlert className="size-5 shrink-0" /><p className="flex-1">{message}</p>{canManageConnection ? <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>Revisar conexão</Button> : null}</div> : null}

      <Tabs defaultValue="accounts">
        <TabsList className="rounded-xl"><TabsTrigger value="accounts"><CircleDollarSign />Contas</TabsTrigger><TabsTrigger value="charges"><Send />Cobranças <Badge variant="secondary">{charges.length}</Badge></TabsTrigger><TabsTrigger value="reports"><Download />Relatórios</TabsTrigger></TabsList>
        <TabsContent value="accounts" className="mt-5"><Card className="overflow-hidden"><CardHeader className="border-b"><div className="flex flex-col gap-4 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><CardTitle className="text-base">Contas a pagar e receber</CardTitle><p className="mt-1 text-sm text-slate-500">Dados oficiais da Drap, filtrados pelo centro de custo quando uma obra é selecionada.</p></div><div className="grid gap-2 sm:grid-cols-3"><Select value={scopeProjectId} onValueChange={setScopeProjectId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Empresa inteira</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select><Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os tipos</SelectItem><SelectItem value="receivable">A receber</SelectItem><SelectItem value="payable">A pagar</SelectItem></SelectContent></Select><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem><SelectItem value="open">Em aberto</SelectItem><SelectItem value="overdue">Vencidas</SelectItem><SelectItem value="paid">Pagas</SelectItem></SelectContent></Select></div></div>{selectedProject && !selectedProject.externalFinancialCostCenterId && canEdit ? <div className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 sm:flex-row sm:items-center"><Link2 className="size-4" /><p className="flex-1">Esta obra ainda não possui centro de custo Drap.</p><Button size="sm" onClick={() => setLinkOpen(true)}>Vincular agora</Button></div> : null}</CardHeader><CardContent className="p-0">{flowLoading ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-blue-600" /></div> : filtered.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="pl-5">Lançamento</TableHead><TableHead>Parte</TableHead><TableHead>Vencimento</TableHead><TableHead>Situação</TableHead><TableHead className="pr-5 text-right">Valor</TableHead></TableRow></TableHeader><TableBody>{filtered.map((item) => <TableRow key={item.id}><TableCell className="pl-5"><p className="font-medium">{item.description}</p><p className="text-xs text-slate-500">{item.type === "receivable" ? "Conta a receber" : "Conta a pagar"}</p></TableCell><TableCell>{item.partyName ?? "Não informado"}</TableCell><TableCell>{formatDate(item.dueDate)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell className={`pr-5 text-right font-semibold tabular-nums ${item.type === "payable" ? "text-red-700" : "text-emerald-700"}`}>{item.type === "payable" ? "−" : "+"}{currency.format(item.amount)}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty className="min-h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><CircleDollarSign /></EmptyMedia><EmptyTitle>Nenhum lançamento disponível</EmptyTitle><EmptyDescription>{capabilities.transactions ? "Não há contas para os filtros atuais ou a obra ainda precisa ser vinculada." : "A consulta de contas será liberada após a homologação do endpoint oficial da Drap."}</EmptyDescription></EmptyHeader>{canEdit && selectedProject && !selectedProject.externalFinancialCostCenterId ? <Button onClick={() => setLinkOpen(true)}><Link2 />Vincular centro de custo</Button> : null}</Empty>}</CardContent></Card></TabsContent>
        <TabsContent value="charges" className="mt-5"><Card><CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle className="text-base">Cobranças criadas</CardTitle><p className="mt-1 text-sm text-slate-500">Somente cobranças confirmadas pela Drap geram link de compartilhamento.</p></div>{canEdit ? <Button onClick={() => setChargeOpen(true)} disabled={!connection || !capabilities.charges}><Plus />Nova cobrança</Button> : null}</div></CardHeader><CardContent>{charges.length ? <div className="space-y-3">{charges.map((charge) => <div key={charge.id} className="flex flex-col gap-3 rounded-2xl border p-4 lg:flex-row lg:items-center"><span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><BellRing className="size-4" /></span><div className="min-w-0 flex-1"><p className="font-medium">{charge.description}</p><p className="mt-1 text-xs text-slate-500">{charge.projectName} · vence {formatDate(charge.dueDate)} · lembrete {charge.reminders.daysBefore ?? 0} dia(s) antes</p></div><p className="font-semibold tabular-nums">{currency.format(charge.amountCents / 100)}</p><StatusBadge status={charge.status} />{charge.shareUrl ? <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(charge.shareUrl!).then(() => toast.success("Link copiado"))}><Clipboard />Copiar link</Button> : null}</div>)}</div> : <Empty className="min-h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><Send /></EmptyMedia><EmptyTitle>Nenhuma cobrança criada</EmptyTitle><EmptyDescription>A plataforma não cria registros locais fingindo uma confirmação financeira.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card></TabsContent>
        <TabsContent value="reports" className="mt-5"><Card><CardHeader><CardTitle className="text-base">Relatório personalizado</CardTitle><p className="text-sm text-slate-500">O arquivo respeita o projeto, tipo, situação e busca aplicados na aba Contas.</p></CardHeader><CardContent><div className="grid gap-4 md:grid-cols-[1fr_auto]"><div className="rounded-2xl border bg-slate-50 p-5"><p className="text-sm font-medium">{filtered.length} lançamento(s) no recorte atual</p><p className="mt-2 text-sm text-slate-500">Escopo: {selectedProject ? `${selectedProject.code} · ${selectedProject.name}` : "empresa inteira"}. O CSV usa os dados oficiais já carregados da Drap.</p></div><Button onClick={exportCsv} disabled={!filtered.length} className="h-full min-h-14"><Download />Exportar CSV</Button></div></CardContent></Card></TabsContent>
      </Tabs>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent><DialogHeader><DialogTitle>Conexão da empresa com a Drap</DialogTitle><DialogDescription>Informe apenas o identificador da empresa. Token e segredo permanecem no servidor da plataforma.</DialogDescription></DialogHeader><form onSubmit={saveConnection} className="space-y-4"><Field name="externalCompanyId" label="ID da empresa na Drap" defaultValue={connection?.externalCompanyId ?? ""} required /><div className="grid grid-cols-3 gap-2 text-center text-xs"><Capability label="Resumo" enabled={capabilities.summary} /><Capability label="Contas" enabled={capabilities.transactions} /><Capability label="Cobranças" enabled={capabilities.charges} /></div><Button type="submit" disabled={saving} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar conexão</Button></form></DialogContent></Dialog>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent><DialogHeader><DialogTitle>Vincular obra ao financeiro</DialogTitle><DialogDescription>O centro de custo separa contas e resultado desta obra. O cliente Drap é necessário para cobranças.</DialogDescription></DialogHeader><form onSubmit={saveProjectLink} className="space-y-4"><div><label className="mb-1.5 block text-sm font-medium">Projeto ou obra</label><Select name="projectId" defaultValue={selectedProject?.id} required><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></div><Field name="externalCostCenterId" label="ID do centro de custo na Drap" required /><Field name="externalCustomerId" label="ID do cliente na Drap" /><Button type="submit" disabled={saving} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <Link2 />}Salvar vínculos</Button></form></DialogContent></Dialog>
      <Dialog open={chargeOpen} onOpenChange={setChargeOpen}><DialogContent><DialogHeader><DialogTitle>Nova cobrança</DialogTitle><DialogDescription>A cobrança só será exibida como criada depois da confirmação oficial da Drap.</DialogDescription></DialogHeader><form onSubmit={createCharge} className="space-y-4"><div><label className="mb-1.5 block text-sm font-medium">Projeto ou obra</label><Select name="projectId" defaultValue={selectedProject?.id !== "all" ? selectedProject?.id : undefined} required><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} · {project.name}</SelectItem>)}</SelectContent></Select></div><Field name="description" label="Descrição da cobrança" required /><div className="grid grid-cols-2 gap-4"><Field name="amount" label="Valor (R$)" placeholder="0,00" required /><Field name="dueDate" label="Vencimento" type="date" required /></div><div className="rounded-2xl border bg-slate-50 p-4"><p className="flex items-center gap-2 text-sm font-medium"><BellRing className="size-4 text-blue-600" />Lembretes automáticos</p><div className="mt-4 grid grid-cols-2 gap-4"><Field name="daysBefore" label="Dias antes" type="number" defaultValue="3" /><Field name="overdueIntervalDays" label="Repetir após vencer" type="number" defaultValue="3" /></div><label className="mt-4 flex items-center gap-3 text-sm"><Checkbox checked={remindOnDueDate} onCheckedChange={(value) => setRemindOnDueDate(value === true)} />Enviar também no vencimento</label></div><Button type="submit" disabled={saving || !capabilities.charges} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <Send />}Criar e obter link</Button></form></DialogContent></Dialog>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Building2; tone: "blue" | "emerald" | "amber" }) {
  const color = tone === "emerald" ? "bg-emerald-50 text-emerald-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700";
  return <Card className="workspace-card border-white/80"><CardContent className="flex items-start justify-between gap-4 p-5"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="metric-number mt-3 text-2xl font-semibold text-slate-950">{value}</p></div><span className={`grid size-10 place-items-center rounded-2xl ${color}`}><Icon className="size-5" /></span></CardContent></Card>;
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return <div className={`rounded-xl border p-3 ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}><p className="font-medium">{label}</p><p className="mt-1">{enabled ? "Disponível" : "Pendente"}</p></div>;
}

function Field({ name, label, type = "text", placeholder, required, defaultValue }: { name: string; label: string; type?: string; placeholder?: string; required?: boolean; defaultValue?: string }) {
  return <div><label htmlFor={`finance-${name}`} className="mb-1.5 block text-sm font-medium">{label}</label><Input id={`finance-${name}`} name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} min={type === "number" ? "0" : undefined} /></div>;
}
