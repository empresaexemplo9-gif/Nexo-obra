"use client";

import { FormEvent, useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SidebarMenuButton } from "@/components/ui/sidebar";

// Troca da própria senha, conferindo a atual. As outras sessões da conta são encerradas.
export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword.length < 10) { setError("A nova senha precisa ter pelo menos 10 caracteres."); return; }
    if (newPassword !== String(data.get("confirmation") ?? "")) { setError("As senhas novas não conferem."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível trocar a senha.");
      setOpen(false); toast.success("Senha alterada. As outras sessões foram encerradas.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível trocar a senha.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <SidebarMenuButton onClick={() => { setError(""); setOpen(true); }} tooltip="Trocar senha" className="text-hoikos-500 hover:text-white"><KeyRound /><span>Trocar senha</span></SidebarMenuButton>
    <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}><DialogContent><DialogHeader><DialogTitle>Trocar senha</DialogTitle><DialogDescription>A nova senha vale para todas as empresas em que você entra.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="senha-atual" className="mb-1.5 block text-sm font-medium">Senha atual</label><Input id="senha-atual" name="currentPassword" type="password" autoComplete="current-password" required /></div>
        <div><label htmlFor="senha-nova" className="mb-1.5 block text-sm font-medium">Nova senha</label><Input id="senha-nova" name="newPassword" type="password" autoComplete="new-password" minLength={10} required aria-describedby="senha-nova-dica" /><p id="senha-nova-dica" className="mt-1.5 text-xs text-hoikos-500">Pelo menos 10 caracteres.</p></div>
        <div><label htmlFor="senha-confirmacao" className="mb-1.5 block text-sm font-medium">Repita a nova senha</label><Input id="senha-confirmacao" name="confirmation" type="password" autoComplete="new-password" required /></div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={saving} className="w-full">{saving ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Salvar nova senha</Button>
      </form>
    </DialogContent></Dialog>
  </>;
}
