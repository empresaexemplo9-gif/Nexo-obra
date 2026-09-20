"use client";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export function ProjectEditor({ project, onChanged }: { project: {
  id: string; code: string; name: string; phase: string; status: string; kind: string;
  progressPercent: number; startDate: string | null; targetDate: string | null;
}; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return; const data = new FormData(event.currentTarget); setSaving(true); setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: data.get("name"), phase: data.get("phase"), status: data.get("status"),
        progressPercent: Number(data.get("progress")), startDate: data.get("start") || null, targetDate: data.get("target") || null,
      }) });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar.");
      setOpen(false); toast.success("Trabalho atualizado"); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  return <><Button variant="outline" onClick={() => { setError(""); setOpen(true); }}>Editar {project.kind === "work" ? "obra" : "projeto"}</Button><Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Editar {project.code}</DialogTitle><DialogDescription>Atualize o andamento e os prazos deste trabalho.</DialogDescription></DialogHeader><form onSubmit={save}><fieldset disabled={saving} className="space-y-3">
    <label className="block text-sm">Nome<Input name="name" minLength={3} maxLength={160} required defaultValue={project.name} /></label>
    <label className="block text-sm">Fase<Input name="phase" minLength={2} maxLength={80} required defaultValue={project.phase} /></label>
    <label className="block text-sm">Situação<NativeSelect name="status" defaultValue={project.status}><option value="active">Em andamento</option><option value="on_hold">Pausado</option><option value="completed">Concluído</option><option value="archived">Arquivado</option></NativeSelect></label>
    <label className="block text-sm">Avanço (%)<Input name="progress" type="number" min={0} max={100} step={1} required defaultValue={project.progressPercent} /></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Início<Input name="start" type="date" defaultValue={project.startDate ?? ""} /></label><label className="text-sm">Prazo alvo<Input name="target" type="date" defaultValue={project.targetDate ?? ""} /></label></div>
    {error && <p role="alert" className="text-sm">{error}</p>}<Button type="submit" className="w-full">{saving ? "Salvando…" : "Salvar alterações"}</Button>
  </fieldset></form></DialogContent></Dialog></>;
}
