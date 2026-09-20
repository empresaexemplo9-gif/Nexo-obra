"use client";
import type { EditableTask } from "./tasks-workspace";

export function ScheduleTimeline({ tasks }: { tasks: Pick<EditableTask, "id" | "title" | "startsAt" | "dueAt" | "status">[] }) {
  const planned = tasks.filter(task => task.startsAt && task.dueAt && Number.isFinite(Date.parse(task.startsAt)) && Number.isFinite(Date.parse(task.dueAt)) && Date.parse(task.dueAt) >= Date.parse(task.startsAt));
  if (!planned.length) return <p className="text-sm text-hoikos-500">Defina início e prazo das tarefas para visualizar a linha do tempo.</p>;
  const min = Math.min(...planned.map(task => Date.parse(task.startsAt!)));
  const max = Math.max(...planned.map(task => Date.parse(task.dueAt!)));
  const span = Math.max(86_400_000, max - min);
  return <details className="rounded-md border bg-white p-4"><summary className="cursor-pointer font-medium">Linha do tempo ({planned.length} tarefas)</summary>
    <p className="my-3 text-xs text-hoikos-500">{new Date(min).toLocaleDateString("pt-BR")} até {new Date(max).toLocaleDateString("pt-BR")} · Prazos corridos, sem ajuste automático de calendário.</p>
    <div className="overflow-x-auto"><div className="min-w-[560px] space-y-2">{planned.map(task => <div key={task.id} className="grid grid-cols-[180px_1fr] items-center gap-3"><span className="truncate text-xs" title={task.title}>{task.title}</span><div className="h-7 rounded bg-hoikos-50"><div className={`h-7 min-w-1 rounded ${task.status === "done" ? "bg-hoikos-400" : "bg-hoikos-700"}`} style={{ marginLeft: `${(Date.parse(task.startsAt!) - min) / span * 100}%`, width: `${Math.max(0.3, (Date.parse(task.dueAt!) - Date.parse(task.startsAt!)) / span * 100)}%` }} role="img" aria-label={`${task.title}: ${new Date(task.startsAt!).toLocaleDateString("pt-BR")} a ${new Date(task.dueAt!).toLocaleDateString("pt-BR")}`} /></div></div>)}</div></div>
  </details>;
}
