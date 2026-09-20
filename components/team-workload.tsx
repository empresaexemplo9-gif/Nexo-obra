"use client";
import { Card } from "@/components/ui/card";
import type { EditableTask } from "./tasks-workspace";
export function TeamWorkload({ members, tasks }: { members: { id: string; name: string; weeklyCapacityMinutes: number }[]; tasks: EditableTask[] }) {
  return <Card className="p-4"><h2 className="font-medium">Carga de tarefas em aberto</h2><p className="mt-1 text-xs text-hoikos-500">Estimativas das tarefas ainda não concluídas. Inclui todo o trabalho pendente; não representa horas trabalhadas.</p><div className="mt-3 divide-y">{members.map(member => {
    const assigned = tasks.filter(task => task.status !== "done" && task.assigneeMemberId === member.id);
    const minutes = assigned.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    return <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span>{member.name}</span><span>{assigned.length} tarefa(s) · {(minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h estimadas · {assigned.filter(task => !task.estimatedMinutes).length} sem estimativa</span></div>;
  })}</div><p className="mt-2 text-xs text-hoikos-500">Sem responsável: {tasks.filter(task => task.status !== "done" && !task.assigneeMemberId).length} tarefa(s).</p></Card>;
}
