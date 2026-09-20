"use client";

import { FormEvent, useMemo, useState } from "react";
import { CalendarRange, Check, CircleAlert, Clock3, Link2, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScheduleTimeline } from "@/components/schedule-timeline";

type Task = {
  id: string; projectId: string; projectName: string; title: string; status: string; priority: string;
  assigneeName: string | null; parentTaskId: string | null; startsAt: string | null; dueAt: string | null;
  estimatedMinutes: number;
};

type Project = { id: string; code: string; name: string; targetDate: string | null };

async function patchTask(id: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Não foi possível atualizar o cronograma.");
}

function displayDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ScheduleWorkspace({ projects, tasks, query, canEdit, onChanged }: {
  projects: Project[]; tasks: Task[]; query: string; canEdit: boolean; onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const visible = useMemo(() => tasks.filter((task) => !normalized || `${task.title} ${task.projectName} ${task.assigneeName ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized)), [tasks, normalized]);
  const scheduleProjects = [...projects];
  for (const task of tasks) {
    if (!scheduleProjects.some(project => project.id === task.projectId)) {
      scheduleProjects.push({ id: task.projectId, code: "", name: task.projectName, targetDate: null });
    }
  }
  const now = new Date();
  const late = tasks.filter((task) => task.status !== "done" && task.dueAt && new Date(task.dueAt) < now).length;
  const missing = tasks.filter((task) => task.status !== "done" && !task.dueAt).length;
  const dependencyMap = new Map(tasks.map((task) => [task.id, task]));
  const conflicts = tasks.filter((task) => {
    if (!task.parentTaskId || !task.startsAt) return false;
    const parent = dependencyMap.get(task.parentTaskId);
    return Boolean(parent?.dueAt && new Date(task.startsAt).getTime() < new Date(parent.dueAt).getTime());
  });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing || !canEdit || saving) return; setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const startsAt = data.get("startsAt") ? new Date(String(data.get("startsAt"))).toISOString() : null;
      const dueAt = data.get("dueAt") ? new Date(String(data.get("dueAt"))).toISOString() : null;
      if (startsAt && dueAt && new Date(dueAt) < new Date(startsAt)) throw new Error("O prazo final não pode ser anterior ao início.");
      await patchTask(editing.id, { startsAt, dueAt, estimatedMinutes: Math.max(0, Math.round(Number(data.get("estimatedMinutes") || 0))), parentTaskId: data.get("parentTaskId") === "none" ? null : data.get("parentTaskId") });
      toast.success("Cronograma atualizado"); setEditing(null); await onChanged();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível atualizar o cronograma."); }
    finally { setSaving(false); }
  }

  return <div className="space-y-5">
    <ScheduleTimeline tasks={visible} />
    <div className="hoikos-module-heading"><div><p className="eyebrow text-hoikos-600">Planejamento</p><h1 className="display-heading mt-2 text-4xl text-hoikos-950">Cronograma</h1><p className="mt-2 text-sm text-hoikos-500">Início, prazo, duração e dependência usam as próprias tarefas da operação.</p></div></div>
    <div className="grid gap-3 sm:grid-cols-3"><Card className="p-5"><p className="text-sm text-hoikos-500">Tarefas planejadas</p><p className="metric-number mt-2 text-2xl font-semibold">{tasks.length}</p></Card><Card className="p-5"><p className="text-sm text-hoikos-500">Sem prazo</p><p className="metric-number mt-2 text-2xl font-semibold">{missing}</p></Card><Card className="p-5"><p className="text-sm text-hoikos-500">Vencidas</p><p className="metric-number mt-2 text-2xl font-semibold">{late}</p></Card></div>
    {conflicts.length ? <Card className="border-hoikos-300"><CardContent className="flex gap-3 p-4 text-sm"><CircleAlert className="mt-0.5 size-5 shrink-0 text-hoikos-700" /><div><p className="font-medium">{conflicts.length} dependência com conflito de data</p><p className="mt-1 text-hoikos-600">A tarefa dependente começa antes de a tarefa anterior terminar. Ajuste as datas antes de assumir o prazo como válido.</p></div></CardContent></Card> : null}
    {!visible.length ? <Card className="p-8 text-center"><CalendarRange className="mx-auto size-8 text-hoikos-500" /><p className="mt-3 font-medium">Nenhuma tarefa para planejar</p><p className="mt-1 text-sm text-hoikos-500">Crie tarefas nos projetos e defina as datas aqui.</p></Card> : <div className="space-y-5">{scheduleProjects.map((project) => { const rows = visible.filter((task) => task.projectId === project.id); if (!rows.length) return null; return <section key={project.id}><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{project.code ? `${project.code} · ` : ""}{project.name}</h2><p className="text-xs text-hoikos-500">Prazo do trabalho: {project.targetDate ? new Date(`${project.targetDate}T12:00:00`).toLocaleDateString("pt-BR") : "não disponível"}</p></div><Badge variant="outline">{rows.filter((task) => task.status !== "done").length} abertas</Badge></div><Card className="overflow-hidden"><div className="divide-y">{rows.map((task) => { const parent = task.parentTaskId ? dependencyMap.get(task.parentTaskId) : null; const conflict = conflicts.some((item) => item.id === task.id); return <button type="button" key={task.id} onClick={() => canEdit && setEditing(task)} className="grid w-full gap-3 p-4 text-left hover:bg-hoikos-50 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] sm:items-center"><div className="min-w-0"><p className="truncate font-medium">{task.title}</p><p className="mt-1 text-xs text-hoikos-500">{task.assigneeName ?? "Sem responsável"}{parent ? ` · depende de ${parent.title}` : ""}</p></div><div className="text-sm"><span className="text-xs text-hoikos-500">Início</span><p>{displayDate(task.startsAt)}</p></div><div className="text-sm"><span className="text-xs text-hoikos-500">Prazo</span><p>{displayDate(task.dueAt)}</p></div><div className="flex items-center gap-2 text-sm"><Clock3 className="size-4 text-hoikos-500" /><span>{task.estimatedMinutes ? `${Math.round(task.estimatedMinutes / 60 * 10) / 10} h` : "Sem estimativa"}</span>{conflict ? <CircleAlert className="size-4 text-hoikos-700" /> : null}</div></button>; })}</div></Card></section>; })}</div>}
    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>Planejar tarefa</DialogTitle><DialogDescription>{editing?.title}</DialogDescription></DialogHeader>{editing ? <form onSubmit={save} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field name="startsAt" label="Início" type="datetime-local" defaultValue={toLocalInput(editing.startsAt)} /><Field name="dueAt" label="Prazo final" type="datetime-local" defaultValue={toLocalInput(editing.dueAt)} /></div><Field name="estimatedMinutes" label="Duração estimada (minutos)" type="number" defaultValue={String(editing.estimatedMinutes ?? 0)} /><div><label htmlFor="parentTaskId" className="mb-1.5 block text-sm font-medium">Depende de</label><select id="parentTaskId" name="parentTaskId" defaultValue={editing.parentTaskId ?? "none"} className="h-9 w-full rounded-md border border-hoikos-200 bg-white px-3 text-sm"><option value="none">Sem dependência</option>{editing.parentTaskId && !tasks.some(task => task.id === editing.parentTaskId) && <option value={editing.parentTaskId}>Dependência atual (fora desta lista)</option>}{tasks.filter((task) => task.id !== editing.id && task.projectId === editing.projectId).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></div><p className="flex items-start gap-2 rounded-md bg-hoikos-50 p-3 text-xs leading-5 text-hoikos-600"><Link2 className="mt-0.5 size-4 shrink-0" />O sistema recusa ciclos e dependências entre projetos. Conflitos de datas são sinalizados; ajuste os prazos manualmente.</p><Button type="submit" className="w-full" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar cronograma</Button></form> : null}</DialogContent></Dialog>
  </div>;
}

function Field({ name, label, type, defaultValue }: { name: string; label: string; type: string; defaultValue: string }) {
  return <div><label htmlFor={`schedule-${name}`} className="mb-1.5 block text-sm font-medium">{label}</label><Input id={`schedule-${name}`} name={name} type={type} defaultValue={defaultValue} min={type === "number" ? 0 : undefined} /></div>;
}
