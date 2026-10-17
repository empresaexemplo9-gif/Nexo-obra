"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  Eye,
  ExternalLink,
  FileSignature,
  LoaderCircle,
  Mail,
  MessageCircle,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ProposalDocument } from "@/components/proposal-document";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { lerValorBrasileiro } from "@/lib/drap-envelope";
import {
  defaultProposalMessage,
  emailUrl,
  formatDateTime,
  formatMoney,
  gmailUrl,
  itemTotalCents,
  newId,
  proposalChannelLabels,
  proposalStatusLabels,
  proposalTotals,
  whatsappNumber,
  whatsappUrl,
  type ProposalChannel,
  type ProposalContent,
  type ProposalItem,
  type ProposalSection,
  type ProposalStatus,
} from "@/lib/proposals";

type Project = { id: string; code: string; name: string };
type Client = { id: string; name: string };
type Budget = { id: string; code: string; version: number; projectName: string | null; status: string; totalCents: number; itemCount: number };

type Proposal = {
  id: string; code: string; title: string; status: ProposalStatus;
  projectId: string | null; projectName: string | null; clientId: string | null; clientName: string | null;
  recipientName: string; recipientEmail: string | null; recipientPhone: string | null;
  totalCents: number; validityDays: number;
  scheduledAt: number | null; scheduledChannel: "email" | "whatsapp" | null;
  issuedAt: number | null; sentAt: number | null; sentChannel: ProposalChannel | null;
  firstViewedAt: number | null; lastViewedAt: number | null; viewCount: number;
  acceptedAt: number | null; acceptedName: string | null; acceptedDocument: string | null;
  unseenNotice: boolean; createdByName: string; createdAt: number; updatedAt: number;
  link: string | null; content?: ProposalContent;
};

type Editable = {
  title: string; recipientName: string; recipientEmail: string; recipientPhone: string; validityDays: number; content: ProposalContent;
};

class RequestError extends Error {}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string; details?: Record<string, string[] | undefined> };
  if (!response.ok) {
    const field = body.details && typeof body.details === "object" ? Object.values(body.details).flat().find(Boolean) : undefined;
    throw new RequestError(field ?? body.error ?? "Não foi possível concluir a operação.");
  }
  return body;
}

const statusTone: Record<ProposalStatus, string> = {
  draft: "border-drap-300 bg-drap-mist text-drap-950",
  scheduled: "border-drap-accent bg-drap-accent text-white",
  sent: "border-drap-warning bg-drap-warning text-drap-950",
  accepted: "border-drap-success bg-drap-success text-white",
  cancelled: "border-drap-danger bg-drap-danger text-white",
};

function StatusBadge({ proposal }: { proposal: Proposal }) {
  const label = proposal.status === "sent" && proposal.firstViewedAt ? "Aberta pelo cliente" : proposalStatusLabels[proposal.status];
  return <Badge variant="outline" className={statusTone[proposal.status]}>{label}</Badge>;
}

const toEditable = (proposal: Proposal): Editable => ({
  title: proposal.title,
  recipientName: proposal.recipientName,
  recipientEmail: proposal.recipientEmail ?? "",
  recipientPhone: proposal.recipientPhone ?? "",
  validityDays: proposal.validityDays,
  content: proposal.content!,
});

const sameEditable = (left: Editable | null, right: Editable | null) => JSON.stringify(left) === JSON.stringify(right);

/** Relógio que anda sozinho: "hora de enviar" vira verdade sem recarregar a tela. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Horário sugerido para agendar: amanhã às 9h, no relógio do navegador. */
function suggestedSchedule() {
  const date = new Date(Date.now() + 86_400_000);
  date.setHours(9, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Valor em reais digitado no padrão brasileiro. Só vira centavos ao sair do campo. */
function MoneyInput({ cents, onChange, disabled, label }: { cents: number; onChange: (cents: number) => void; disabled?: boolean; label: string }) {
  const [text, setText] = useState(() => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  return (
    <Input
      aria-label={label} inputMode="decimal" value={shown} disabled={disabled} className="text-right tabular-nums"
      onFocus={() => { setText((cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })); setFocused(true); }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => { setFocused(false); const value = lerValorBrasileiro(text); onChange(value === null ? 0 : Math.max(0, Math.round(value * 100))); }}
    />
  );
}

function SectionsEditor({ label, sections, onChange, disabled }: { label: string; sections: ProposalSection[]; onChange: (sections: ProposalSection[]) => void; disabled: boolean }) {
  const update = (index: number, patch: Partial<ProposalSection>) => onChange(sections.map((section, position) => position === index ? { ...section, ...patch } : section));
  const move = (index: number, delta: number) => {
    const next = [...sections];
    const [section] = next.splice(index, 1);
    next.splice(index + delta, 0, section);
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {sections.map((section, index) => (
        <div key={section.id} className="grid gap-2 rounded-md border border-drap-200 bg-drap-50 p-3">
          <div className="flex items-center gap-2">
            <Input aria-label={`Título da seção ${index + 1} ${label}`} value={section.title} disabled={disabled} maxLength={120} placeholder="Título da seção" onChange={(event) => update(index, { title: event.target.value })} className="font-medium" />
            <Button type="button" variant="ghost" size="icon" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label="Subir seção"><ArrowUp /></Button>
            <Button type="button" variant="ghost" size="icon" disabled={disabled || index === sections.length - 1} onClick={() => move(index, 1)} aria-label="Descer seção"><ArrowDown /></Button>
            <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={() => onChange(sections.filter((_, position) => position !== index))} aria-label={`Remover a seção ${section.title || index + 1}`}><Trash2 /></Button>
          </div>
          <Textarea aria-label={`Texto da seção ${section.title || index + 1}`} value={section.body} disabled={disabled} maxLength={8000} rows={4} placeholder="Escreva o texto desta seção. Deixe uma linha em branco para começar outro parágrafo." onChange={(event) => update(index, { body: event.target.value })} />
        </div>
      ))}
      {sections.length < 20 ? <Button type="button" variant="outline" size="sm" className="w-fit" disabled={disabled} onClick={() => onChange([...sections, { id: newId(), title: "", body: "" }])}><Plus />Adicionar seção {label}</Button> : null}
    </div>
  );
}

function ItemsEditor({ items, onChange, disabled }: { items: ProposalItem[]; onChange: (items: ProposalItem[]) => void; disabled: boolean }) {
  const update = (index: number, patch: Partial<ProposalItem>) => onChange(items.map((item, position) => position === index ? { ...item, ...patch } : item));
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-md border border-drap-200">
        <Table className="min-w-[52rem]">
          <TableHeader><TableRow><TableHead className="min-w-72">Descrição</TableHead><TableHead className="w-24">Unid.</TableHead><TableHead className="w-28 text-right">Qtd.</TableHead><TableHead className="w-36 text-right">Valor unit. (R$)</TableHead><TableHead className="w-32 text-right">Total</TableHead><TableHead className="w-12"><span className="sr-only">Remover</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {items.length ? items.map((item, index) => (
              <TableRow key={item.id}>
                <TableCell><Input aria-label={`Descrição do item ${index + 1}`} value={item.description} disabled={disabled} maxLength={500} onChange={(event) => update(index, { description: event.target.value })} /></TableCell>
                <TableCell><Input aria-label={`Unidade do item ${index + 1}`} value={item.unit} disabled={disabled} maxLength={20} onChange={(event) => update(index, { unit: event.target.value })} /></TableCell>
                <TableCell><Input aria-label={`Quantidade do item ${index + 1}`} type="number" min={0} step="any" value={Number.isFinite(item.quantity) ? item.quantity : 0} disabled={disabled} className="text-right tabular-nums" onChange={(event) => update(index, { quantity: Math.max(0, Number(event.target.value) || 0) })} /></TableCell>
                <TableCell><MoneyInput label={`Valor unitário do item ${index + 1}`} cents={item.unitPriceCents} disabled={disabled} onChange={(cents) => update(index, { unitPriceCents: cents })} /></TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(itemTotalCents(item))}</TableCell>
                <TableCell><Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={() => onChange(items.filter((_, position) => position !== index))} aria-label={`Remover o item ${index + 1}`}><Trash2 /></Button></TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-drap-500">Nenhum item. Inclua ao menos um para poder enviar.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {items.length < 300 ? <Button type="button" variant="outline" size="sm" className="w-fit" disabled={disabled} onClick={() => onChange([...items, { id: newId(), description: "Novo item", unit: "un", quantity: 1, unitPriceCents: 0 }])}><Plus />Adicionar item</Button> : null}
    </div>
  );
}

function CreateDialog({ open, onOpenChange, projects, clients, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; projects: Project[]; clients: Client[]; onCreated: (proposal: Proposal) => void;
}) {
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [budgetsError, setBudgetsError] = useState("");
  const [title, setTitle] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || budgets) return;
    requestJson<{ budgets: Budget[] }>("/api/budgets")
      .then((body) => setBudgets(body.budgets.filter((budget) => budget.status !== "archived")))
      .catch((cause) => setBudgetsError(cause instanceof Error ? cause.message : "Não foi possível carregar os orçamentos."));
  }, [open, budgets]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const body = await requestJson<{ proposal: Proposal }>("/api/proposals", { method: "POST", body: JSON.stringify({
        title, budgetVersionId: budgetId || null, projectId: budgetId ? null : projectId || null, clientId: clientId || null,
      }) });
      setTitle(""); setBudgetId(""); setProjectId(""); setClientId("");
      onCreated(body.proposal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a proposta.");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Nova proposta</DialogTitle><DialogDescription>Comece de um orçamento para trazer os itens e valores, ou em branco. Tudo pode ser editado depois.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div><label htmlFor="proposta-titulo" className="mb-1.5 block text-sm font-medium">Título</label><Input id="proposta-titulo" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} maxLength={160} placeholder="Ex.: Projeto de interiores — Apartamento 302" /></div>
          <div>
            <label htmlFor="proposta-orcamento" className="mb-1.5 block text-sm font-medium">Orçamento de origem</label>
            <NativeSelect id="proposta-orcamento" value={budgetId} onChange={(event) => setBudgetId(event.target.value)} className="w-full" disabled={!budgets}>
              <option value="">Em branco</option>
              {(budgets ?? []).map((budget) => <option key={budget.id} value={budget.id}>{budget.code} v{budget.version}{budget.projectName ? ` · ${budget.projectName}` : ""} · {formatMoney(budget.totalCents)}</option>)}
            </NativeSelect>
            {budgetsError ? <p className="mt-1 text-xs text-drap-danger">{budgetsError}</p> : !budgets ? <p className="mt-1 text-xs text-drap-500">Carregando orçamentos…</p> : null}
          </div>
          {!budgetId ? (
            <div>
              <label htmlFor="proposta-projeto" className="mb-1.5 block text-sm font-medium">Projeto <span className="font-normal text-drap-500">(opcional)</span></label>
              <NativeSelect id="proposta-projeto" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full">
                <option value="">Sem projeto</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
              </NativeSelect>
            </div>
          ) : null}
          <div>
            <label htmlFor="proposta-cliente" className="mb-1.5 block text-sm font-medium">Cliente <span className="font-normal text-drap-500">(se vazio, vem do projeto)</span></label>
            <NativeSelect id="proposta-cliente" value={clientId} onChange={(event) => setClientId(event.target.value)} className="w-full">
              <option value="">Do projeto</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </NativeSelect>
          </div>
          {error ? <p role="alert" className="text-sm text-drap-danger">{error}</p> : null}
          <Button type="submit" disabled={saving || title.trim().length < 2}>{saving ? <LoaderCircle className="animate-spin" /> : <Plus />}Criar proposta</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Timeline({ proposal }: { proposal: Proposal }) {
  const rows: Array<[string, string, boolean]> = [
    ["Criada", `${formatDateTime(proposal.createdAt)} · ${proposal.createdByName}`, true],
    ["Emitida", proposal.issuedAt ? formatDateTime(proposal.issuedAt) : "No primeiro envio", Boolean(proposal.issuedAt)],
    ["Enviada", proposal.sentAt ? `${formatDateTime(proposal.sentAt)} · ${proposal.sentChannel ? proposalChannelLabels[proposal.sentChannel] : ""}` : proposal.scheduledAt ? `Agendada para ${formatDateTime(proposal.scheduledAt)}` : "Ainda não", Boolean(proposal.sentAt)],
    ["Aberta pelo cliente", proposal.firstViewedAt ? `${formatDateTime(proposal.firstViewedAt)}${proposal.viewCount > 1 ? ` · ${proposal.viewCount} aberturas, última ${formatDateTime(proposal.lastViewedAt ?? proposal.firstViewedAt)}` : ""}` : "Ainda não", Boolean(proposal.firstViewedAt)],
    ["Aceita", proposal.acceptedAt ? `${formatDateTime(proposal.acceptedAt)} · ${proposal.acceptedName}${proposal.acceptedDocument ? ` · ${proposal.acceptedDocument}` : ""}` : "Ainda não", Boolean(proposal.acceptedAt)],
  ];
  return (
    <ol className="grid gap-3">
      {rows.map(([label, detail, done]) => (
        <li key={label} className="flex gap-3 text-sm">
          <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${done ? "border-drap-success bg-drap-success text-white" : "border-drap-300 text-transparent"}`}><Check className="size-3" /></span>
          <span><span className="block font-medium">{label}</span><span className="text-drap-500">{detail}</span></span>
        </li>
      ))}
    </ol>
  );
}

function Editor({ proposalId, organizationName, timezone, canEdit, onBack, onChanged }: {
  proposalId: string; organizationName: string; timezone: string; canEdit: boolean; onBack: () => void; onChanged: (proposal: Proposal) => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<Editable | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [scheduleAt, setScheduleAt] = useState(suggestedSchedule);
  const [scheduleChannel, setScheduleChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [messageTouched, setMessageTouched] = useState(false);
  const now = useNow();

  const apply = useCallback((next: Proposal) => {
    setProposal(next); setDraft(toEditable(next)); onChanged(next);
  }, [onChanged]);

  useEffect(() => {
    let cancelled = false;
    requestJson<{ proposal: Proposal }>(`/api/proposals/${proposalId}`)
      .then((body) => { if (!cancelled) apply(body.proposal); })
      .catch((cause) => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "Não foi possível abrir a proposta."); });
    return () => { cancelled = true; };
  }, [proposalId, apply]);

  const saved = useMemo(() => proposal ? toEditable(proposal) : null, [proposal]);
  const dirty = Boolean(draft && saved && !sameEditable(draft, saved));
  const locked = !canEdit || proposal?.status === "accepted" || proposal?.status === "cancelled";
  const defaultMessage = useMemo(() => proposal && draft ? defaultProposalMessage({ recipientName: draft.recipientName, organizationName, code: proposal.code, title: draft.title }) : "", [proposal, draft, organizationName]);
  const shownMessage = messageTouched ? message : defaultMessage;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (loadError) return <Card><CardContent className="flex items-center gap-3 py-8 text-sm"><CircleAlert className="text-drap-danger" />{loadError}<Button variant="outline" size="sm" onClick={onBack}>Voltar</Button></CardContent></Card>;
  if (!proposal || !draft) return <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-drap-600" aria-label="Carregando proposta" /></div>;

  const setContent = (patch: Partial<ProposalContent>) => setDraft({ ...draft, content: { ...draft.content, ...patch } });
  const totals = proposalTotals(draft.content);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const body = await requestJson<{ proposal: Proposal }>(`/api/proposals/${proposalId}`, { method: "PATCH", body: JSON.stringify({
        title: draft.title, recipientName: draft.recipientName, recipientEmail: draft.recipientEmail || null,
        recipientPhone: draft.recipientPhone || null, validityDays: draft.validityDays, content: draft.content,
      }) });
      apply(body.proposal);
      toast.success("Proposta salva");
    } catch (cause) {
      // Erro de rede não descarta nada: o rascunho continua na tela para tentar de novo.
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar. Suas alterações continuam na tela.");
    } finally { setSaving(false); }
  }

  async function send(channel: ProposalChannel, via?: "gmail") {
    if (!proposal || !draft) return;
    if (dirty) { toast.error("Salve as alterações antes de enviar."); return; }
    // A janela abre antes da chamada: navegador bloqueia janela aberta depois de esperar a rede.
    const popup = channel === "whatsapp" || via === "gmail" ? window.open("", "_blank") : null;
    setBusy(`send-${channel}`);
    try {
      const body = await requestJson<{ proposal: Proposal }>(`/api/proposals/${proposalId}/send`, { method: "POST", body: JSON.stringify({ channel }) });
      apply(body.proposal);
      const link = body.proposal.link!;
      const subject = `Proposta ${body.proposal.code} — ${body.proposal.title}`;
      if (channel === "whatsapp") {
        const url = whatsappUrl(draft.recipientPhone, shownMessage, link);
        if (popup) popup.location.href = url; else window.location.href = url;
        toast.success("WhatsApp aberto com a proposta. Confira e toque em enviar.");
      } else if (channel === "email") {
        const url = via === "gmail" ? gmailUrl(draft.recipientEmail, subject, shownMessage, link) : emailUrl(draft.recipientEmail, subject, shownMessage, link);
        if (popup) popup.location.href = url; else window.location.href = url;
        toast.success("E-mail aberto com a proposta. Confira e envie.");
      } else {
        try { await navigator.clipboard.writeText(link); toast.success("Link copiado. A proposta está no ar."); }
        catch { toast.message("Copie o link no campo abaixo.", { description: link }); }
      }
    } catch (cause) {
      popup?.close();
      toast.error(cause instanceof Error ? cause.message : "Não foi possível enviar.");
    } finally { setBusy(null); }
  }

  async function schedule(event: FormEvent) {
    event.preventDefault();
    if (dirty) { toast.error("Salve as alterações antes de agendar."); return; }
    setBusy("schedule");
    try {
      const at = new Date(scheduleAt);
      if (Number.isNaN(at.getTime())) throw new Error("Informe data e hora válidas.");
      const body = await requestJson<{ proposal: Proposal }>(`/api/proposals/${proposalId}/schedule`, { method: "POST", body: JSON.stringify({ channel: scheduleChannel, at: at.toISOString() }) });
      apply(body.proposal);
      toast.success(`Envio agendado para ${formatDateTime(at.getTime())}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível agendar.");
    } finally { setBusy(null); }
  }

  async function unschedule() {
    setBusy("unschedule");
    try { apply((await requestJson<{ proposal: Proposal }>(`/api/proposals/${proposalId}/schedule`, { method: "DELETE" })).proposal); toast.success("Agendamento cancelado"); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível cancelar o agendamento."); }
    finally { setBusy(null); }
  }

  async function cancelProposal() {
    if (!window.confirm(`Cancelar a proposta ${proposal?.code}? O link deixa de abrir para o cliente.`)) return;
    setBusy("cancel");
    try { apply((await requestJson<{ proposal: Proposal }>(`/api/proposals/${proposalId}`, { method: "DELETE" })).proposal); toast.success("Proposta cancelada"); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível cancelar."); }
    finally { setBusy(null); }
  }

  const scheduledDue = proposal.status === "scheduled" && proposal.scheduledAt !== null && proposal.scheduledAt <= now;
  const canSend = canEdit && ["draft", "scheduled", "sent"].includes(proposal.status);
  const phoneOk = Boolean(whatsappNumber(draft.recipientPhone));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => { if (!dirty || window.confirm("Sair sem salvar as alterações?")) onBack(); }}><ArrowLeft />Propostas</Button>
        <div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-[0.16em] text-drap-band">{proposal.code}</p><h2 className="truncate text-xl font-medium">{draft.title || "Sem título"}</h2></div>
        <StatusBadge proposal={proposal} />
        {canEdit && !locked ? <Button onClick={() => void save()} disabled={!dirty || saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}{dirty ? "Salvar alterações" : "Salvo"}</Button> : null}
      </div>

      {proposal.status === "accepted" ? <div role="status" className="flex items-start gap-3 rounded-md border border-drap-success bg-drap-success px-4 py-3 text-sm text-white"><CheckCircle2 className="mt-0.5 size-5 shrink-0" /><p>Aceita por <strong>{proposal.acceptedName}</strong> em {formatDateTime(proposal.acceptedAt!)}. A proposta está travada; o aceite guarda a versão exata que o cliente leu.</p></div> : null}
      {proposal.status === "sent" && canEdit ? <p className="rounded-md border border-drap-warning bg-drap-warning px-4 py-2 text-sm text-drap-950">Já enviada: o que você salvar aparece para o cliente no mesmo link, com o aviso de que a proposta foi atualizada.</p> : null}
      {scheduledDue ? <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-drap-accent bg-drap-accent px-4 py-3 text-sm text-white"><CalendarClock className="size-5" /><p className="flex-1">Hora de enviar: agendada para {formatDateTime(proposal.scheduledAt!)} por {proposal.scheduledChannel === "whatsapp" ? "WhatsApp" : "e-mail"}.</p><Button size="sm" variant="secondary" onClick={() => void send(proposal.scheduledChannel ?? "whatsapp")} disabled={Boolean(busy)}>Enviar agora</Button></div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Tabs defaultValue="edit" className="min-w-0">
          <TabsList><TabsTrigger value="edit">Editar</TabsTrigger><TabsTrigger value="preview"><Eye />Ver como o cliente</TabsTrigger></TabsList>
          <TabsContent value="edit" className="mt-4">
            <Card>
              <CardContent className="grid gap-6 pt-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label htmlFor="ed-titulo" className="mb-1.5 block text-sm font-medium">Título da proposta</label><Input id="ed-titulo" value={draft.title} disabled={locked} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
                  <div><label htmlFor="ed-cabecalho" className="mb-1.5 block text-sm font-medium">Cabeçalho do documento</label><Input id="ed-cabecalho" value={draft.content.heading} disabled={locked} maxLength={160} onChange={(event) => setContent({ heading: event.target.value })} /></div>
                </div>
                <div className="grid gap-2"><h3 className="text-sm font-semibold">Antes dos valores</h3><SectionsEditor label="antes dos valores" sections={draft.content.sectionsBefore} disabled={locked} onChange={(sectionsBefore) => setContent({ sectionsBefore })} /></div>
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-48 flex-1"><label htmlFor="ed-itens" className="mb-1.5 block text-sm font-semibold">Título dos valores</label><Input id="ed-itens" value={draft.content.itemsTitle} disabled={locked} maxLength={120} onChange={(event) => setContent({ itemsTitle: event.target.value })} /></div>
                  </div>
                  <ItemsEditor items={draft.content.items} disabled={locked} onChange={(items) => setContent({ items })} />
                  <div className="ml-auto grid w-full max-w-sm gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3"><span>Subtotal</span><span className="tabular-nums">{formatMoney(totals.subtotalCents)}</span></div>
                    <div className="flex items-center justify-between gap-3"><label htmlFor="ed-desconto">Desconto (R$)</label><div className="w-36"><MoneyInput label="Desconto em reais" cents={draft.content.discountCents} disabled={locked} onChange={(discountCents) => setContent({ discountCents })} /></div></div>
                    <div className="flex items-center justify-between gap-3 border-t border-drap-300 pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(totals.totalCents)}</span></div>
                  </div>
                </div>
                <div className="grid gap-2"><h3 className="text-sm font-semibold">Depois dos valores</h3><SectionsEditor label="depois dos valores" sections={draft.content.sectionsAfter} disabled={locked} onChange={(sectionsAfter) => setContent({ sectionsAfter })} /></div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <div><label htmlFor="ed-fechamento" className="mb-1.5 block text-sm font-medium">Fechamento</label><Textarea id="ed-fechamento" value={draft.content.closing} disabled={locked} maxLength={2000} rows={3} onChange={(event) => setContent({ closing: event.target.value })} /></div>
                  <div><label htmlFor="ed-validade" className="mb-1.5 block text-sm font-medium">Validade (dias)</label><Input id="ed-validade" type="number" min={1} max={365} value={draft.validityDays} disabled={locked} onChange={(event) => setDraft({ ...draft, validityDays: Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1))) })} /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="preview" className="mt-4">
            <div className="rounded-sm bg-white px-5 py-8 shadow-sm sm:px-10">
              <ProposalDocument data={{ code: proposal.code, title: draft.title, organizationName, timezone, recipientName: draft.recipientName, projectName: proposal.projectName, issuedAt: proposal.issuedAt, validityDays: draft.validityDays, content: draft.content }} />
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Enviar ao cliente</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div><label htmlFor="env-nome" className="mb-1.5 block text-sm font-medium">Nome</label><Input id="env-nome" value={draft.recipientName} disabled={locked} maxLength={160} autoComplete="off" onChange={(event) => setDraft({ ...draft, recipientName: event.target.value })} /></div>
              <div><label htmlFor="env-email" className="mb-1.5 block text-sm font-medium">E-mail</label><Input id="env-email" type="email" value={draft.recipientEmail} disabled={locked} maxLength={200} autoComplete="off" onChange={(event) => setDraft({ ...draft, recipientEmail: event.target.value })} /></div>
              <div><label htmlFor="env-whats" className="mb-1.5 block text-sm font-medium">WhatsApp</label><Input id="env-whats" type="tel" value={draft.recipientPhone} disabled={locked} maxLength={40} placeholder="(62) 99999-0000" autoComplete="off" onChange={(event) => setDraft({ ...draft, recipientPhone: event.target.value })} />{draft.recipientPhone && !phoneOk ? <p className="mt-1 text-xs text-drap-danger">Número incompleto: o WhatsApp abre para você escolher o contato.</p> : null}</div>
              <div><label htmlFor="env-mensagem" className="mb-1.5 block text-sm font-medium">Mensagem</label><Textarea id="env-mensagem" rows={5} value={shownMessage} disabled={!canSend} onChange={(event) => { setMessageTouched(true); setMessage(event.target.value); }} /><p className="mt-1 text-xs text-drap-500">O link da proposta vai no fim da mensagem.</p></div>
              {dirty && canSend ? <p className="text-xs text-drap-danger">Salve as alterações antes de enviar.</p> : null}
              <div className="grid gap-2">
                <Button onClick={() => void send("whatsapp")} disabled={!canSend || dirty || Boolean(busy)}>{busy === "send-whatsapp" ? <LoaderCircle className="animate-spin" /> : <MessageCircle />}Enviar por WhatsApp</Button>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Button variant="outline" onClick={() => void send("email")} disabled={!canSend || dirty || Boolean(busy) || !draft.recipientEmail}>{busy === "send-email" ? <LoaderCircle className="animate-spin" /> : <Mail />}Enviar por e-mail</Button>
                  <Button variant="outline" onClick={() => void send("email", "gmail")} disabled={!canSend || dirty || Boolean(busy) || !draft.recipientEmail} aria-label="Enviar pelo Gmail no navegador">Gmail</Button>
                </div>
                <Button variant="ghost" onClick={() => void send("link")} disabled={!canSend || dirty || Boolean(busy)}><Copy />Copiar link</Button>
              </div>
              {proposal.link ? <div className="grid gap-1"><label htmlFor="env-link" className="text-xs text-drap-500">Link do cliente</label><div className="flex gap-2"><Input id="env-link" readOnly value={proposal.link} onFocus={(event) => event.currentTarget.select()} className="text-xs" /><Button asChild variant="outline" size="icon"><a href={proposal.link} target="_blank" rel="noreferrer" aria-label="Abrir a página do cliente"><ExternalLink /></a></Button></div></div> : null}
            </CardContent>
          </Card>

          {canEdit && (proposal.status === "draft" || proposal.status === "scheduled") ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Agendar envio</CardTitle></CardHeader>
              <CardContent>
                {proposal.status === "scheduled" ? (
                  <div className="grid gap-3 text-sm">
                    <p>Agendada para <strong>{formatDateTime(proposal.scheduledAt!)}</strong> por {proposal.scheduledChannel === "whatsapp" ? "WhatsApp" : "e-mail"}. Na hora marcada, você recebe o aviso nos lembretes com o envio pronto.</p>
                    <Button variant="outline" onClick={() => void unschedule()} disabled={Boolean(busy)}><X />Cancelar agendamento</Button>
                  </div>
                ) : (
                  <form onSubmit={schedule} className="grid gap-3">
                    <div><label htmlFor="ag-quando" className="mb-1.5 block text-sm font-medium">Data e hora</label><Input id="ag-quando" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} required /></div>
                    <div><label htmlFor="ag-canal" className="mb-1.5 block text-sm font-medium">Canal</label><NativeSelect id="ag-canal" value={scheduleChannel} onChange={(event) => setScheduleChannel(event.target.value as "whatsapp" | "email")} className="w-full"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></NativeSelect></div>
                    <p className="text-xs leading-5 text-drap-500">O link só fica no ar depois do envio. Na hora marcada a proposta aparece em “Hora de enviar”, com a mensagem pronta.</p>
                    <Button type="submit" variant="outline" disabled={dirty || Boolean(busy)}>{busy === "schedule" ? <LoaderCircle className="animate-spin" /> : <CalendarClock />}Agendar envio</Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle className="text-base">Acompanhamento</CardTitle></CardHeader>
            <CardContent className="grid gap-4"><Timeline proposal={proposal} />{canEdit && proposal.status !== "accepted" && proposal.status !== "cancelled" ? <Button variant="ghost" className="w-fit text-drap-danger" onClick={() => void cancelProposal()} disabled={Boolean(busy)}><Trash2 />Cancelar proposta</Button> : null}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ProposalsWorkspace({ projects, clients, query, canEdit, organizationName, timezone }: {
  projects: Project[]; clients: Client[]; query: string; canEdit: boolean; organizationName: string; timezone: string;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const known = useRef<Map<string, { viewed: number | null; accepted: number | null }> | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const body = await requestJson<{ proposals: Proposal[] }>("/api/proposals");
      // Aviso na hora: enquanto a aba está aberta, abertura e aceite viram notificação.
      if (known.current) {
        for (const item of body.proposals) {
          const before = known.current.get(item.id);
          if (!before) continue;
          if (item.acceptedAt && item.acceptedAt !== before.accepted) toast.success(`${item.code} aceita por ${item.acceptedName}`, { duration: 10_000 });
          else if (item.lastViewedAt && item.firstViewedAt && item.firstViewedAt !== before.viewed) toast.message(`O cliente abriu a proposta ${item.code}`, { description: item.title, duration: 10_000 });
        }
      }
      known.current = new Map(body.proposals.map((item) => [item.id, { viewed: item.firstViewedAt, accepted: item.acceptedAt }]));
      setProposals(body.proposals); setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as propostas.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  const onChanged = useCallback((proposal: Proposal) => {
    setProposals((current) => current ? [proposal, ...current.filter((item) => item.id !== proposal.id)].map((item) => item.id === proposal.id ? { ...item, ...proposal, unseenNotice: false } : item) : current);
    known.current?.set(proposal.id, { viewed: proposal.firstViewedAt, accepted: proposal.acceptedAt });
  }, []);

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const rows = useMemo(() => (proposals ?? []).filter((proposal) => !normalized || `${proposal.code} ${proposal.title} ${proposal.recipientName} ${proposal.clientName ?? ""} ${proposal.projectName ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized)), [proposals, normalized]);
  const dueNow = rows.filter((proposal) => proposal.status === "scheduled" && proposal.scheduledAt !== null && proposal.scheduledAt <= now);

  if (selectedId) return <Editor key={selectedId} proposalId={selectedId} organizationName={organizationName} timezone={timezone} canEdit={canEdit} onBack={() => { setSelectedId(null); void load(); }} onChanged={onChanged} />;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-drap-500">{proposals ? `${rows.length} proposta${rows.length === 1 ? "" : "s"}` : "Carregando…"}</p>
        {canEdit ? <Button onClick={() => setCreateOpen(true)}><Plus />Nova proposta</Button> : null}
      </div>
      {dueNow.length ? (
        <div role="status" className="grid gap-2 rounded-md border border-drap-accent bg-drap-accent px-4 py-3 text-sm text-white">
          <p className="flex items-center gap-2 font-medium"><CalendarClock className="size-4" />Hora de enviar</p>
          {dueNow.map((proposal) => <button key={proposal.id} type="button" onClick={() => setSelectedId(proposal.id)} className="w-fit text-left underline underline-offset-2">{proposal.code} — {proposal.title} · agendada para {formatDateTime(proposal.scheduledAt!)}</button>)}
        </div>
      ) : null}
      {error ? <Card><CardContent className="flex items-center gap-3 py-6 text-sm"><CircleAlert className="text-drap-danger" />{error}<Button variant="outline" size="sm" onClick={() => void load()}>Tentar de novo</Button></CardContent></Card> : null}
      {!proposals && !error ? <div className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin text-drap-600" aria-label="Carregando propostas" /></div> : null}
      {proposals && !rows.length ? (
        <Card><Empty className="min-h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><FileSignature /></EmptyMedia><EmptyTitle>{normalized ? "Nenhuma proposta encontrada" : "Nenhuma proposta ainda"}</EmptyTitle><EmptyDescription>{normalized ? "Nenhuma proposta tem esse código, título ou cliente." : "Crie a primeira a partir de um orçamento ou em branco, ajuste o texto e envie por WhatsApp ou e-mail."}</EmptyDescription></EmptyHeader>{canEdit && !normalized ? <Button onClick={() => setCreateOpen(true)}><Plus />Nova proposta</Button> : null}</Empty></Card>
      ) : null}
      {rows.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-5">Proposta</TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Situação</TableHead><TableHead className="pr-5">Última novidade</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((proposal) => (
                  <TableRow key={proposal.id} className="cursor-pointer" onClick={() => setSelectedId(proposal.id)}>
                    <TableCell className="pl-5">
                      <button type="button" className="text-left" onClick={(event) => { event.stopPropagation(); setSelectedId(proposal.id); }}>
                        <span className="flex items-center gap-2 font-medium text-drap-900">{proposal.unseenNotice ? <span className="size-2 shrink-0 rounded-full bg-drap-accent" aria-label="Novidade" /> : null}{proposal.title}</span>
                        <span className="block text-xs text-drap-500">{proposal.code}{proposal.projectName ? ` · ${proposal.projectName}` : ""}</span>
                      </button>
                    </TableCell>
                    <TableCell>{proposal.recipientName || proposal.clientName || <span className="text-drap-500">Sem cliente</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(proposal.totalCents)}</TableCell>
                    <TableCell><StatusBadge proposal={proposal} /></TableCell>
                    <TableCell className="pr-5 text-sm text-drap-500">{proposal.acceptedAt ? `Aceita em ${formatDateTime(proposal.acceptedAt)}` : proposal.lastViewedAt ? `Aberta em ${formatDateTime(proposal.lastViewedAt)}` : proposal.sentAt ? `Enviada em ${formatDateTime(proposal.sentAt)}` : proposal.scheduledAt ? `Envio em ${formatDateTime(proposal.scheduledAt)}` : `Editada em ${formatDateTime(proposal.updatedAt)}`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}
      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} projects={projects} clients={clients} onCreated={(proposal) => { setCreateOpen(false); onChanged(proposal); setSelectedId(proposal.id); toast.success(`${proposal.code} criada`); }} />
    </div>
  );
}
