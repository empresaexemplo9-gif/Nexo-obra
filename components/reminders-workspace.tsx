"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, BellRing, Check, CircleAlert, LoaderCircle, Plus, Target, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { lerValorBrasileiro } from "@/lib/drap-envelope";

export type Reminder = {
  key: string; group: "cobranca" | "boleto" | "followup" | "tarefa" | "meta" | "recado";
  severity: "atrasado" | "hoje" | "proximo";
  title: string; detail: string; amountCents: number | null; dueDay: string | null;
  module: string; entityId: string;
};
export type Goal = {
  id: string; name: string; metric: string; label: string; money: boolean;
  target: number; current: number; percent: number; periodStart: string; periodEnd: string;
  ownerMemberId: string | null; mine: boolean;
};
export type Agenda = {
  day: string; horizon: string; seen: boolean; reminders: Reminder[];
  dismissedCount: number; counts: { atrasado: number; hoje: number; proximo: number }; goals: Goal[];
};

const groupLabels: Record<Reminder["group"], string> = {
  cobranca: "Cobrança", boleto: "Boleto", followup: "Follow-up", tarefa: "Tarefa", meta: "Meta", recado: "Recado",
};
const severityLabels: Record<Reminder["severity"], string> = {
  atrasado: "Atrasado", hoje: "Hoje", proximo: "Próximos dias",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body as T;
}

const currency = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00.000Z`).toLocaleDateString("pt-BR");

// Recarrega ao abrir e quando o dia vira, para o lembrete acompanhar a data real.
export function useReminders(enabled: boolean) {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    try { setAgenda(await api<Agenda>("/api/reminders")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os lembretes."); }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 10 * 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [enabled, load]);

  const mark = useCallback(async (itemKey: string, state: "dismissed" | "seen") => {
    try { setAgenda(await api<Agenda>("/api/reminders", { method: "POST", body: JSON.stringify({ itemKey, state }) })); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível atualizar o lembrete."); }
  }, []);

  const pending = agenda ? agenda.counts.atrasado + agenda.counts.hoje : 0;
  return { agenda, error, reload: load, mark, pending };
}

export function ReminderBell({ pending, onOpen }: { pending: number; onOpen: () => void }) {
  return <Button variant="ghost" size="icon" onClick={onOpen} className="relative"
    aria-label={pending ? `Lembretes do dia: ${pending} para hoje ou atrasados` : "Lembretes do dia"}>
    <BellRing />
    {pending ? <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-hoikos-800 px-1 text-[10px] font-semibold text-white">{pending > 99 ? "99+" : pending}</span> : null}
  </Button>;
}

function GoalForm({ metrics, members, onCreated }: {
  metrics: Array<{ id: string; label: string; money: boolean }>;
  members: Array<{ id: string; name: string }>;
  onCreated: () => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState(metrics[0]?.id ?? "");
  const [target, setTarget] = useState("");
  const [periodStart, setPeriodStart] = useState(today.slice(0, 8) + "01");
  const [periodEnd, setPeriodEnd] = useState(endOfMonth);
  const [ownerMemberId, setOwnerMemberId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isMoney = metrics.find((item) => item.id === metric)?.money ?? false;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      // "1.5" virava 15 e "50.5" em reais virava R$ 5.050,00: tirava todo ponto.
      const raw = lerValorBrasileiro(target) ?? Number.NaN;
      if (!Number.isFinite(raw) || raw <= 0) throw new Error("Informe um alvo maior que zero.");
      await api("/api/goals", { method: "POST", body: JSON.stringify({
        name, metric, targetValue: isMoney ? Math.round(raw * 100) : Math.round(raw),
        periodStart, periodEnd, ownerMemberId: ownerMemberId || null,
      }) });
      setName(""); setTarget(""); setOpen(false);
      await onCreated();
      toast.success("Meta criada");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar a meta.");
    } finally { setSaving(false); }
  }

  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus />Nova meta</Button>;

  return <form onSubmit={submit} className="grid gap-3 rounded-md border border-hoikos-200 bg-hoikos-50 p-4 sm:grid-cols-2">
    <label className="text-sm sm:col-span-2">Nome da meta
      <Input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} placeholder="Faturamento de setembro" className="mt-1 h-10" />
    </label>
    <label className="text-sm">O que medir
      <NativeSelect value={metric} onChange={(event) => setMetric(event.target.value)} className="mt-1 h-10">
        {metrics.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </NativeSelect>
    </label>
    <label className="text-sm">Alvo {isMoney ? "(R$)" : "(quantidade)"}
      <Input value={target} onChange={(event) => setTarget(event.target.value)} required inputMode="decimal" placeholder={isMoney ? "50.000,00" : "10"} className="mt-1 h-10" />
    </label>
    <label className="text-sm">De<Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} required className="mt-1 h-10" /></label>
    <label className="text-sm">Até<Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} required className="mt-1 h-10" /></label>
    <label className="text-sm sm:col-span-2">Responsável
      <NativeSelect value={ownerMemberId} onChange={(event) => setOwnerMemberId(event.target.value)} className="mt-1 h-10">
        <option value="">Meta da empresa inteira</option>
        {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </NativeSelect>
    </label>
    {error ? <p role="alert" className="text-sm text-hoikos-700 sm:col-span-2">{error}</p> : null}
    <div className="flex gap-2 sm:col-span-2">
      <Button type="submit" size="sm" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Criar meta</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
    </div>
  </form>;
}

export function RemindersWorkspace({ agenda, error, reload, mark, members }: {
  agenda: Agenda | null; error: string; reload: () => Promise<void>;
  mark: (itemKey: string, state: "dismissed" | "seen") => Promise<void>;
  members: Array<{ id: string; name: string }>;
}) {
  const [metrics, setMetrics] = useState<Array<{ id: string; label: string; money: boolean }>>([]);
  const [canManage, setCanManage] = useState(false);

  const loadGoals = useCallback(async () => {
    try {
      const result = await api<{ metrics: typeof metrics; canManage: boolean }>("/api/goals");
      setMetrics(result.metrics);
      setCanManage(result.canManage);
    } catch { /* metas indisponíveis não impedem os lembretes */ }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadGoals(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGoals]);

  const grouped = useMemo(() => {
    const buckets: Record<Reminder["severity"], Reminder[]> = { atrasado: [], hoje: [], proximo: [] };
    for (const reminder of agenda?.reminders ?? []) buckets[reminder.severity].push(reminder);
    return buckets;
  }, [agenda]);

  async function closeGoal(id: string) {
    try { await api(`/api/goals/${id}`, { method: "DELETE" }); await reload(); toast.success("Meta encerrada"); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível encerrar."); }
  }

  if (error && !agenda) {
    return <Card className="border-hoikos-200"><CardContent className="flex flex-col items-start gap-3 p-6">
      <CircleAlert className="size-6 text-hoikos-600" /><p className="text-sm text-hoikos-800">{error}</p>
      <Button onClick={() => void reload()}>Tentar novamente</Button>
    </CardContent></Card>;
  }
  if (!agenda) return <Card><CardContent className="grid min-h-56 place-items-center"><LoaderCircle className="size-6 animate-spin text-hoikos-600" /></CardContent></Card>;

  const total = agenda.reminders.length;

  return <div className="space-y-5">
    <Card className="workspace-card">
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <AlarmClock className="size-4 text-hoikos-600" />Lembretes de {dayLabel(agenda.day)}
          {agenda.counts.atrasado ? <Badge variant="outline" className="border-hoikos-400">{agenda.counts.atrasado} atrasado(s)</Badge> : null}
          {agenda.counts.hoje ? <Badge variant="outline">{agenda.counts.hoje} para hoje</Badge> : null}
        </CardTitle>
        <p className="text-sm leading-6 text-hoikos-500">
          Cobranças a confirmar, boletos a vencer, follow-ups do funil, tarefas com prazo, recados da Comunicação e metas em aberto até {dayLabel(agenda.horizon)}.
          Cada lembrete aponta para um registro real e some sozinho quando o registro deixa de estar pendente.
          {agenda.dismissedCount ? ` ${agenda.dismissedCount} dispensado(s) hoje.` : ""}
        </p>
      </CardHeader>
    </Card>

    {total === 0 ? (
      <Card><CardContent className="grid min-h-48 place-items-center p-6 text-center"><div>
        <Check className="mx-auto size-7 text-hoikos-600" />
        <p className="mt-3 font-medium text-hoikos-900">Nada pendente para hoje</p>
        <p className="mt-1 text-sm text-hoikos-500">Nenhuma cobrança, boleto, follow-up, tarefa, recado ou meta exige ação agora.</p>
      </div></CardContent></Card>
    ) : (["atrasado", "hoje", "proximo"] as const).filter((severity) => grouped[severity].length).map((severity) => (
      <Card key={severity} className="overflow-hidden">
        <CardHeader className="border-b py-3"><CardTitle className="text-sm font-semibold text-hoikos-700">{severityLabels[severity]} · {grouped[severity].length}</CardTitle></CardHeader>
        <CardContent className="divide-y p-0">
          {grouped[severity].map((reminder) => (
            <div key={reminder.key} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <Badge variant="outline" className="w-fit shrink-0">{groupLabels[reminder.group]}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-hoikos-900">{reminder.title}</p>
                <p className="mt-0.5 text-sm text-hoikos-500">{reminder.detail}</p>
              </div>
              {reminder.amountCents ? <p className="shrink-0 font-semibold tabular-nums">{currency(reminder.amountCents)}</p> : null}
              <Button size="sm" variant="ghost" onClick={() => void mark(reminder.key, "dismissed")} aria-label={`Dispensar hoje: ${reminder.title}`}>
                <X />Dispensar hoje
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    ))}

    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b">
        <CardTitle className="flex items-center gap-2 text-base"><Target className="size-4 text-hoikos-600" />Metas do período</CardTitle>
        {canManage && metrics.length ? <GoalForm metrics={metrics} members={members} onCreated={reload} /> : null}
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {agenda.goals.length === 0 ? (
          <p className="py-6 text-center text-sm text-hoikos-500">
            {canManage ? "Nenhuma meta ativa. Crie uma e o realizado é calculado a partir dos dados reais da empresa." : "Nenhuma meta ativa para você no período."}
          </p>
        ) : agenda.goals.map((goal) => (
          <div key={goal.id} className="rounded-md border border-hoikos-100 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-hoikos-900">{goal.name}</p>
              <Badge variant="outline">{goal.label}</Badge>
              {goal.mine ? <Badge variant="outline">Sua meta</Badge> : null}
              <span className="ml-auto text-sm tabular-nums text-hoikos-600">
                {goal.money ? currency(goal.current) : goal.current} de {goal.money ? currency(goal.target) : goal.target}
              </span>
              {canManage ? <Button size="sm" variant="ghost" onClick={() => void closeGoal(goal.id)} aria-label={`Encerrar meta ${goal.name}`}><Trash2 /></Button> : null}
            </div>
            <Progress value={Math.min(100, goal.percent)} className="mt-3" />
            <p className="mt-2 text-xs text-hoikos-500">
              {goal.percent}% · {dayLabel(goal.periodStart)} a {dayLabel(goal.periodEnd)}
              {goal.percent >= 100 ? " · meta batida" : ""}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  </div>;
}
