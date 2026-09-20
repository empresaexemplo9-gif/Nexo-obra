"use client";

import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

export type EditableTask = {
  id: string; projectId: string; projectName: string; title: string; description?: string;
  status: string; priority: string; assigneeMemberId?: string | null; assigneeName: string | null;
  startsAt: string | null; dueAt: string | null; parentTaskId: string | null; estimatedMinutes: number;
};
const statuses = { todo: "A fazer", in_progress: "Em execução", blocked: "Bloqueada", done: "Concluída" };
const priorities = { low: "Baixa", normal: "Normal", high: "Alta", critical: "Crítica" };
export function localDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function TasksWorkspace({ tasks, members, query, canEdit, onCreate, onChanged }: {
  tasks: EditableTask[]; members: { id: string; name: string }[]; query: string; canEdit: boolean;
  onCreate: () => void; onChanged: () => Promise<void>;
}) {
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<EditableTask | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const visible = useMemo(() => tasks.filter(task => (status === "all" || task.status === status)
    && `${task.title} ${task.projectName} ${task.assigneeName ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))), [tasks, status, query]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing || saving || !canEdit) return;
    const form = new FormData(event.currentTarget); setSaving(true); setError("");
    try {
      const startsAt = form.get("startsAt") ? new Date(String(form.get("startsAt"))).toISOString() : null;
      const dueAt = form.get("dueAt") ? new Date(String(form.get("dueAt"))).toISOString() : null;
      const response = await fetch(`/api/tasks/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        title: form.get("title"), description: form.get("description"), status: form.get("status"), priority: form.get("priority"),
        assigneeMemberId: form.get("assignee") || null, parentTaskId: form.get("parent") || null,
        startsAt, dueAt, estimatedMinutes: Number(form.get("estimate") || 0),
      }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a tarefa.");
      setEditing(null); toast.success("Tarefa atualizada"); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="display-heading text-4xl">Tarefas</h1>{canEdit && <Button onClick={onCreate}>Nova tarefa</Button>}</div>
    <div className="flex flex-wrap items-center gap-3"><NativeSelect aria-label="Filtrar tarefas por situação" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todas as situações</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect><span className="text-sm text-hoikos-500">{visible.length} tarefa(s)</span></div>
    {!visible.length ? <Card className="p-6 text-sm">Nenhuma tarefa corresponde aos filtros. Crie uma tarefa ou ajuste a busca.</Card> : <Card><CardContent className="divide-y p-0">{visible.map(task => <div key={task.id} className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1"><p className="font-medium">{task.title}</p><p className="text-xs text-hoikos-500">{task.projectName} · {task.assigneeName ?? "Sem responsável"}</p><p className="mt-1 text-xs">{task.dueAt ? `Prazo: ${new Date(task.dueAt).toLocaleDateString("pt-BR")}` : "Sem prazo"} · Prioridade {priorities[task.priority as keyof typeof priorities] ?? task.priority}</p></div>
      <span className="text-sm">{statuses[task.status as keyof typeof statuses] ?? task.status}</span>
      {canEdit && <Button size="sm" variant="outline" aria-label={`Editar tarefa ${task.title}`} onClick={() => { setError(""); setEditing(task); }}>Editar</Button>}
    </div>)}</CardContent></Card>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Editar tarefa</DialogTitle><DialogDescription>Atualize situação, responsável e planejamento. Para reabrir, escolha A fazer.</DialogDescription></DialogHeader>
      {editing && <form onSubmit={save}><fieldset disabled={saving} className="space-y-3">
        <label className="block text-sm">Título<Input name="title" required minLength={3} maxLength={200} defaultValue={editing.title} /></label>
        <label className="block text-sm">Descrição<Textarea name="description" maxLength={8000} defaultValue={editing.description ?? ""} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Situação<NativeSelect name="status" defaultValue={editing.status}>{Object.entries(statuses).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label><label className="text-sm">Prioridade<NativeSelect name="priority" defaultValue={editing.priority}>{Object.entries(priorities).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label></div>
        <label className="block text-sm">Responsável<NativeSelect name="assignee" defaultValue={editing.assigneeMemberId ?? ""}><option value="">Sem responsável</option>{editing.assigneeMemberId && !members.some(m => m.id === editing.assigneeMemberId) && <option value={editing.assigneeMemberId}>{editing.assigneeName ?? "Responsável atual"}</option>}{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</NativeSelect></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Início<Input name="startsAt" type="datetime-local" defaultValue={localDateInput(editing.startsAt)} /></label><label className="text-sm">Prazo final<Input name="dueAt" type="datetime-local" defaultValue={localDateInput(editing.dueAt)} /></label></div>
        <label className="block text-sm">Estimativa (minutos)<Input name="estimate" type="number" min={0} max={100000} step={1} defaultValue={editing.estimatedMinutes} /></label>
        <label className="block text-sm">Depende de<NativeSelect name="parent" defaultValue={editing.parentTaskId ?? ""}><option value="">Sem dependência</option>{editing.parentTaskId && !tasks.some(t => t.id === editing.parentTaskId) && <option value={editing.parentTaskId}>Dependência atual (fora desta lista)</option>}{tasks.filter(t => t.id !== editing.id && t.projectId === editing.projectId).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</NativeSelect></label>
        {error && <p role="alert" className="text-sm text-hoikos-700">{error}</p>}<Button type="submit" className="w-full">{saving ? "Salvando…" : "Salvar tarefa"}</Button>
      </fieldset></form>}
    </DialogContent></Dialog>
  </div>;
}
