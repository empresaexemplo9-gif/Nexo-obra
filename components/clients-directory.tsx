"use client";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Client = { id: string; name: string; email?: string | null; phone?: string | null; document?: string | null };
export function ClientsDirectory({ clients, query, canEdit, onChanged }: { clients: Client[]; query: string; canEdit: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<Client | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const filtered = clients.filter(client => `${client.name} ${client.email ?? ""} ${client.phone ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving || !canEdit) return;
    const form = new FormData(event.currentTarget); setSaving(true); setError("");
    try {
      const response = await fetch(editing ? `/api/clients/${editing.id}` : "/api/clients", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: form.get("email") || null, phone: form.get("phone") || null, document: form.get("document") || null }) });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o cliente.");
      setOpen(false); toast.success(editing ? "Cliente atualizado" : "Cliente cadastrado"); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  return <Card className="p-4"><details><summary className="cursor-pointer font-medium">Clientes ({clients.length})</summary><div className="mt-3 space-y-3">
    {canEdit && <Button size="sm" onClick={() => { setEditing(null); setError(""); setOpen(true); }}>Cadastrar cliente</Button>}
    {!filtered.length && <p className="text-sm text-hoikos-500">Nenhum cliente corresponde à busca.</p>}
    <div className="max-h-80 overflow-auto divide-y">{filtered.map(client => <div key={client.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-medium">{client.name}</p><p className="break-words text-xs text-hoikos-500">{[client.email, client.phone].filter(Boolean).join(" · ") || "Sem contato cadastrado"}</p></div>{canEdit && <Button size="sm" variant="outline" aria-label={`Editar cliente ${client.name}`} onClick={() => { setEditing(client); setError(""); setOpen(true); }}>Editar</Button>}</div>)}</div>
  </div></details><Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>{editing ? "Editar cliente" : "Cadastrar cliente"}</DialogTitle><DialogDescription>Os dados ficam disponíveis nos projetos e oportunidades desta empresa.</DialogDescription></DialogHeader><form key={editing?.id ?? "new"} onSubmit={save}><fieldset disabled={saving} className="space-y-3">
    <label className="block text-sm">Nome<Input name="name" required minLength={2} maxLength={160} defaultValue={editing?.name ?? ""} /></label>
    <label className="block text-sm">E-mail<Input name="email" type="email" maxLength={254} defaultValue={editing?.email ?? ""} /></label>
    <label className="block text-sm">Telefone<Input name="phone" type="tel" maxLength={32} defaultValue={editing?.phone ?? ""} /></label>
    <label className="block text-sm">CPF/CNPJ<Input name="document" maxLength={24} defaultValue={editing?.document ?? ""} /></label>
    {error && <p role="alert" className="text-sm">{error}</p>}<Button type="submit" className="w-full">{saving ? "Salvando…" : "Salvar cliente"}</Button>
  </fieldset></form></DialogContent></Dialog></Card>;
}
