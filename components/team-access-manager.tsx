"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clipboard, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  accessProfileLabels,
  permissionModuleLabels,
  permissionModules,
  permissionsForRole,
  type PermissionModule,
  type PermissionSet,
} from "@/lib/permissions";

export type TeamMember = { id: string; name: string; email: string; role: string; permissions: PermissionSet; weeklyCapacityMinutes: number };
type Invitation = { id: string; email: string; role: string; permissions: PermissionSet; expiresAt: number; status: "pending" | "accepted" | "expired" | "revoked" };
type Profile = "admin" | "manager" | "member" | "partner" | "service_provider" | "finance" | "accounting";

const profiles: Profile[] = ["member", "manager", "partner", "service_provider", "finance", "accounting", "admin"];
const statusLabels = { pending: "Pendente", accepted: "Aceito", expired: "Expirado", revoked: "Revogado" };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body as T;
}

function accessCount(permissions: PermissionSet) {
  return permissionModules.filter((module) => permissions[module].view).length;
}

export function TeamAccessManager({ members, canManage }: { members: TeamMember[]; canManage: boolean }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Profile>("member");
  const [permissions, setPermissions] = useState<PermissionSet>(() => permissionsForRole("member"));
  const [link, setLink] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestJson<{ invitations: Invitation[] }>("/api/organization-invitations");
      setInvitations(data.invitations);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível carregar os convites."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function chooseProfile(value: Profile) {
    setRole(value);
    setPermissions(permissionsForRole(value));
  }

  function setGrant(module: PermissionModule, action: "view" | "edit", checked: boolean) {
    setPermissions((current) => ({
      ...current,
      [module]: action === "edit"
        ? { view: checked || current[module].view, edit: checked }
        : { view: checked, edit: checked ? current[module].edit : false },
    }));
  }

  async function createInvite() {
    setSaving(true);
    try {
      const data = await requestJson<{ invitationPath: string }>("/api/organization-invitations", {
        method: "POST",
        body: JSON.stringify({ email, role, permissions, expiresInDays: 7 }),
      });
      const invitationUrl = new URL(data.invitationPath, window.location.origin).toString();
      setLink(invitationUrl);
      await navigator.clipboard.writeText(invitationUrl).catch(() => undefined);
      toast.success("Convite criado", { description: "O link foi copiado e pode ser enviado ao usuário." });
      await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível criar o convite."); }
    finally { setSaving(false); }
  }

  async function revoke(id: string) {
    try {
      await requestJson(`/api/organization-invitations/${id}`, { method: "DELETE" });
      toast.success("Convite revogado");
      await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível revogar."); }
  }

  function newInvite() {
    setEmail(""); setRole("member"); setPermissions(permissionsForRole("member")); setLink(""); setOpen(true);
  }

  return <div className="space-y-5">
    <Card className="overflow-hidden border-cyan-100 bg-gradient-to-br from-white via-white to-cyan-50/70 shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Controle da empresa</p><CardTitle className="mt-2">Pessoas e permissões</CardTitle><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">O contratante define exatamente o que cada colaborador, parceiro, prestador, financeiro ou contador pode visualizar e editar.</p></div>
        {canManage ? <Button onClick={newInvite} className="shrink-0 rounded-xl"><UserPlus />Criar acesso</Button> : <Badge variant="outline" className="shrink-0"><ShieldCheck />Somente leitura</Badge>}
      </CardHeader>
    </Card>

    <div className="grid gap-3 md:grid-cols-2">{members.map((member) => <Card key={member.id} className="p-5"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-cyan-500 font-semibold text-slate-950 shadow-sm">{member.name.slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate font-medium">{member.name}</p><p className="truncate text-xs text-slate-500">{member.email}</p><p className="mt-1 text-xs text-slate-400">{accessCount(member.permissions)} de {permissionModules.length} áreas visíveis</p></div><Badge variant="outline">{accessProfileLabels[member.role] ?? member.role}</Badge></div></Card>)}</div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4 text-cyan-600" />Convites</CardTitle></CardHeader><CardContent className="space-y-2">{loading ? <LoaderCircle className="mx-auto my-8 animate-spin text-cyan-600" /> : invitations.length ? invitations.map((invitation) => <div key={invitation.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{invitation.email}</p><p className="mt-1 text-xs text-slate-500">{accessProfileLabels[invitation.role] ?? invitation.role} · {accessCount(invitation.permissions)} áreas</p></div><Badge variant="outline">{statusLabels[invitation.status]}</Badge>{canManage && invitation.status === "pending" ? <Button variant="ghost" size="icon" aria-label="Revogar convite" onClick={() => void revoke(invitation.id)}><Trash2 className="size-4 text-red-500" /></Button> : null}</div>) : <p className="py-8 text-center text-sm text-slate-500">Nenhum convite criado ainda.</p>}</CardContent></Card>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Novo acesso à empresa</DialogTitle><DialogDescription>Escolha um perfil inicial e ajuste as permissões. Editar sempre inclui visualizar.</DialogDescription></DialogHeader>{link ? <div className="space-y-4"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="flex items-center gap-2 font-medium text-emerald-900"><Check className="size-4" />Link pronto para envio</p><p className="mt-2 break-all text-sm text-emerald-800">{link}</p></div><Button className="w-full" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copiado"); }}><Clipboard />Copiar link</Button></div> : <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-sm font-medium" htmlFor="invite-email">E-mail do usuário</label><Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com.br" /></div><div><label className="mb-2 block text-sm font-medium">Perfil</label><Select value={role} onValueChange={(value) => chooseProfile(value as Profile)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{profiles.map((profile) => <SelectItem key={profile} value={profile}>{accessProfileLabels[profile]}</SelectItem>)}</SelectContent></Select></div></div><div className="overflow-hidden rounded-2xl border border-slate-200"><div className="grid grid-cols-[1fr_88px_88px] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Área</span><span className="text-center">Ver</span><span className="text-center">Editar</span></div>{permissionModules.map((module) => <div key={module} className="grid grid-cols-[1fr_88px_88px] items-center border-t border-slate-100 px-4 py-3"><span className="text-sm font-medium text-slate-700">{permissionModuleLabels[module]}</span><span className="flex justify-center"><Checkbox checked={permissions[module].view} onCheckedChange={(value) => setGrant(module, "view", value === true)} aria-label={`Visualizar ${permissionModuleLabels[module]}`} /></span><span className="flex justify-center"><Checkbox checked={permissions[module].edit} onCheckedChange={(value) => setGrant(module, "edit", value === true)} aria-label={`Editar ${permissionModuleLabels[module]}`} /></span></div>)}</div><Button onClick={() => void createInvite()} disabled={saving || !email.includes("@")} className="h-11 w-full rounded-xl">{saving ? <LoaderCircle className="animate-spin" /> : <Plus />}Gerar link de acesso</Button></div>}</DialogContent></Dialog>
  </div>;
}
