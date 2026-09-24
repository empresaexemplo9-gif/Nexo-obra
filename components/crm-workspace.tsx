"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CircleAlert, LoaderCircle, Plus, Target } from "lucide-react";
import { toast } from "sonner";

import { localDateInput } from "@/components/tasks-workspace";
import { ClientsDirectory } from "@/components/clients-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Client = { id: string; name: string };
type Member = { id: string; name: string };
type Opportunity = {
  id: string; clientId: string | null; clientName: string | null; title: string; stage: string;
  estimatedValueCents: number; probabilityPercent: number; ownerMemberId: string | null;
  ownerName: string | null; nextAction: string | null; nextActionAt: string | null;
  wonProjectId: string | null; wonProjectName: string | null; lostReason: string | null;
};

const defaultStages = [
  { value: "new", label: "Novo" },
  { value: "diagnosis", label: "Diagnóstico" },
  { value: "proposal", label: "Proposta" },
  { value: "negotiation", label: "Negociação" },
  { value: "won", label: "Ganho" },
  { value: "lost", label: "Perdido" },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body as T;
}

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function localDate(value: string | null) {
  if (!value) return "Sem próximo passo";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sem data" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function CrmWorkspace({ clients, members, query, canEdit, canConvert = canEdit, onProjectsChanged }: {
  clients: Client[]; members: Member[]; query: string; canEdit: boolean; canConvert?: boolean; onProjectsChanged: () => Promise<void>;
}) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  // Oportunidade com mudança de etapa em andamento: o seletor fica travado até a resposta,
  // senão duas mudanças rápidas podiam chegar fora de ordem e deixar a etapa anterior.
  const [movendo, setMovendo] = useState<string | null>(null);
  const [stages, setStages] = useState<string[]>(defaultStages.map((stage) => stage.value));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [convert, setConvert] = useState<Opportunity | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api<{ opportunities: Opportunity[]; stages: string[] }>("/api/crm");
      setOpportunities(result.opportunities); setStages(result.stages);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar o funil."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = useMemo(() => opportunities.filter((item) => !normalized || `${item.title} ${item.clientName ?? ""} ${item.ownerName ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized)), [opportunities, normalized]);
  const openValue = opportunities.filter((item) => item.stage !== "won" && item.stage !== "lost").reduce((total, item) => total + item.estimatedValueCents, 0);
  const weighted = opportunities.filter((item) => item.stage !== "won" && item.stage !== "lost").reduce((total, item) => total + Math.round(item.estimatedValueCents * item.probabilityPercent / 100), 0);

  async function createOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canEdit || saving) return; setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      await api(editing ? `/api/crm/${editing.id}` : "/api/crm", { method: editing ? "PATCH" : "POST", body: JSON.stringify({
        clientId: data.get("clientId"), title: data.get("title"), stage: data.get("stage"),
        estimatedValueCents: Math.round(Number(data.get("estimatedValue") || 0) * 100),
        probabilityPercent: Number(data.get("probability") || 0),
        ownerMemberId: data.get("ownerMemberId") === "none" ? null : data.get("ownerMemberId"),
        nextAction: data.get("nextAction") || null,
        nextActionAt: data.get("nextActionAt") ? new Date(String(data.get("nextActionAt"))).toISOString() : null,
      }) });
      setCreateOpen(false); toast.success(editing ? "Oportunidade atualizada" : "Oportunidade criada"); await reload();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível criar a oportunidade."); }
    finally { setSaving(false); }
  }

  async function changeStage(item: Opportunity, stage: string) {
    if (movendo) return;
    setMovendo(item.id);
    try {
      await api(`/api/crm/${item.id}`, { method: "PATCH", body: JSON.stringify({ stage, probabilityPercent: stage === "won" ? 100 : item.probabilityPercent }) });
      await reload();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível mover a oportunidade."); }
    finally { setMovendo(null); }
  }

  async function convertOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!convert || !canConvert || saving) return; setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/crm/${convert.id}`, { method: "POST", body: JSON.stringify({
        code: data.get("code"), projectName: data.get("projectName") || undefined,
        kind: data.get("kind"), targetDate: data.get("targetDate") || null,
      }) });
      toast.success("Oportunidade convertida em trabalho"); setConvert(null); await reload(); await onProjectsChanged();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível converter a oportunidade."); }
    finally { setSaving(false); }
  }

  const labels = new Map(defaultStages.map((stage) => [stage.value, stage.label]));
  for (const stage of stages) if (!labels.has(stage)) labels.set(stage, stage);

  return <div className="space-y-5">
    <div className="hoikos-module-heading flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow text-hoikos-600">Comercial</p><h1 className="display-heading mt-2 text-4xl text-hoikos-950">CRM e clientes</h1><p className="mt-2 text-sm text-hoikos-500">Funil persistente, próximos passos e conversão direta em projeto ou obra.</p></div>{canEdit ? <Button onClick={() => { setEditing(null); setCreateOpen(true); }} disabled={!clients.length}><Plus />Nova oportunidade</Button> : null}</div>
    <ClientsDirectory clients={clients} query={query} canEdit={canEdit} onChanged={onProjectsChanged} />
    <div className="grid gap-3 sm:grid-cols-3"><Card className="p-5"><p className="text-sm text-hoikos-500">Oportunidades abertas</p><p className="metric-number mt-2 text-2xl font-semibold">{opportunities.filter((item) => item.stage !== "won" && item.stage !== "lost").length}</p></Card><Card className="p-5"><p className="text-sm text-hoikos-500">Valor em aberto</p><p className="metric-number mt-2 text-2xl font-semibold">{money(openValue)}</p></Card><Card className="p-5"><p className="text-sm text-hoikos-500">Valor ponderado</p><p className="metric-number mt-2 text-2xl font-semibold">{money(weighted)}</p></Card></div>
    {loading ? <Card className="p-8 text-center text-sm text-hoikos-500"><LoaderCircle className="mx-auto mb-3 animate-spin" />Carregando funil…</Card> : error ? <Card className="p-6"><p className="flex items-center gap-2 text-sm text-hoikos-700"><CircleAlert className="size-4" />{error}</p><Button variant="outline" className="mt-4" onClick={() => void reload()}>Tentar novamente</Button></Card> : !opportunities.length ? <Card className="p-8 text-center"><Target className="mx-auto size-8 text-hoikos-500" /><p className="mt-3 font-medium">Nenhuma oportunidade cadastrada</p><p className="mt-1 text-sm text-hoikos-500">Cadastre um cliente e abra a primeira oportunidade real.</p></Card> : <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">{Array.from(labels.entries()).map(([stage, label]) => <section key={stage} className="min-w-0"><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{label}</h2><Badge variant="outline">{filtered.filter((item) => item.stage === stage).length}</Badge></div><div className="space-y-2">{filtered.filter((item) => item.stage === stage).map((item) => <Card key={item.id}><CardContent className="p-4"><p className="font-medium leading-5">{item.title}</p><p className="mt-1 text-xs text-hoikos-500">{item.clientName ?? "Sem cliente"}</p><p className="mt-3 font-semibold">{money(item.estimatedValueCents)}</p><p className="mt-1 text-xs text-hoikos-500">{item.probabilityPercent}% · {item.ownerName ?? "Sem responsável"}</p><p className="mt-3 text-xs leading-5 text-hoikos-600">{item.nextAction || "Sem próximo passo"}<br />{localDate(item.nextActionAt)}</p>{canEdit && !item.wonProjectId ? <div className="mt-3 space-y-2"><Button size="sm" variant="outline" className="w-full" onClick={() => { setEditing(item); setCreateOpen(true); }}>Editar oportunidade</Button><select aria-label={`Etapa de ${item.title}`} value={item.stage} disabled={movendo !== null} aria-busy={movendo === item.id} onChange={(event) => void changeStage(item, event.target.value)} className="h-9 w-full rounded-md border border-hoikos-200 bg-white px-2 text-xs">{Array.from(labels.entries()).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>{canConvert && item.stage !== "lost" ? <Button size="sm" variant="outline" className="w-full" onClick={() => setConvert(item)}>Converter <ArrowRight /></Button> : null}</div> : item.wonProjectId ? <p className="mt-3 text-xs font-medium text-hoikos-700">Convertida: {item.wonProjectName}</p> : null}</CardContent></Card>)}</div></section>)}</div>}
    <Dialog open={createOpen} onOpenChange={value => { if (!saving) setCreateOpen(value); }}><DialogContent><DialogHeader><DialogTitle>{editing ? "Editar oportunidade" : "Nova oportunidade"}</DialogTitle><DialogDescription>Registre apenas uma oportunidade comercial real.</DialogDescription></DialogHeader><form key={editing?.id ?? "new"} onSubmit={createOpportunity} className="space-y-4"><Field label="Título" name="title" defaultValue={editing?.title} required /><Choice label="Cliente" name="clientId" defaultValue={editing?.clientId ?? undefined} options={clients.map((client) => ({ value: client.id, label: client.name }))} required /><Choice label="Etapa" name="stage" options={editing ? Array.from(labels, ([value, label]) => ({ value, label })) : defaultStages.filter((stage) => stage.value !== "won" && stage.value !== "lost")} defaultValue={editing?.stage ?? "new"} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Valor estimado (R$)" name="estimatedValue" type="number" defaultValue={editing ? String(editing.estimatedValueCents / 100) : undefined} /><Field label="Probabilidade (%)" name="probability" type="number" defaultValue={editing ? String(editing.probabilityPercent) : undefined} /></div><Choice label="Responsável" name="ownerMemberId" options={[{ value: "none", label: "Sem responsável" }, ...(editing?.ownerMemberId && !members.some(member => member.id === editing.ownerMemberId) ? [{ value: editing.ownerMemberId, label: editing.ownerName ?? "Responsável atual" }] : []), ...members.map((member) => ({ value: member.id, label: member.name }))]} defaultValue={editing?.ownerMemberId ?? "none"} /><Field label="Próximo passo" name="nextAction" defaultValue={editing?.nextAction ?? undefined} /><Field label="Data do próximo passo" name="nextActionAt" type="datetime-local" defaultValue={localDateInput(editing?.nextActionAt ?? null)} /><Button type="submit" className="w-full" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar oportunidade</Button></form></DialogContent></Dialog>
    <Dialog open={Boolean(convert)} onOpenChange={(open) => { if (!open) setConvert(null); }}><DialogContent><DialogHeader><DialogTitle>Converter sem recadastrar</DialogTitle><DialogDescription>O cliente, responsável e valor seguem para o novo trabalho.</DialogDescription></DialogHeader><form onSubmit={convertOpportunity} className="space-y-4"><Field label="Código do trabalho" name="code" placeholder="ARQ-001" required /><Field label="Nome do projeto/obra" name="projectName" defaultValue={convert?.title} required /><Choice label="Tipo" name="kind" options={[{ value: "project", label: "Projeto" }, { value: "work", label: "Obra" }]} defaultValue="project" /><Field label="Prazo alvo" name="targetDate" type="date" /><Button type="submit" className="w-full" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}Converter</Button></form></DialogContent></Dialog>
  </div>;
}

function Field({ label, name, type = "text", required, placeholder, defaultValue }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string }) {
  return <div><label htmlFor={`crm-${name}`} className="mb-1.5 block text-sm font-medium">{label}</label><Input id={`crm-${name}`} name={name} type={type} step={type === "number" ? (name === "estimatedValue" ? "0.01" : "1") : undefined} min={type === "number" ? 0 : undefined} max={name === "probability" ? 100 : undefined} required={required} placeholder={placeholder} defaultValue={defaultValue} /></div>;
}
function Choice({ label, name, options, required, defaultValue }: { label: string; name: string; options: { value: string; label: string }[]; required?: boolean; defaultValue?: string }) {
  return <div><label htmlFor={`crm-${name}`} className="mb-1.5 block text-sm font-medium">{label}</label><select id={`crm-${name}`} name={name} required={required} defaultValue={defaultValue ?? options[0]?.value} className="h-9 w-full rounded-md border border-hoikos-200 bg-white px-3 text-sm">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}
