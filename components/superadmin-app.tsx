"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  Eye,
  EyeOff,
  FolderKanban,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LogOut,
  MailPlus,
  ShieldCheck,
  Target,
  Users,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Session = { authenticated: true; email: string; expiresAt: number };
type Overview = {
  totals: { organizations: number; members: number; clients: number; projects: number; open_tasks: number };
  organizations: Array<{
    id: string; name: string; slug: string; createdAt: string;
    members: number; clients: number; projects: number; openTasks: number;
  }>;
};
type Invitation = {
  id: string; organizationId: string; organizationName: string; email: string; role: string;
  expiresAt: number; acceptedAt: number | null; createdAt: number; status: "pending" | "accepted" | "expired" | "revoked";
};
const roleLabels: Record<string, string> = { admin: "Administrador", manager: "Gestor", member: "Membro" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body as T;
}

function Login({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await api<Session>("/api/superadmin/session", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onAuthenticated(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[#06111f] p-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(11,207,221,0.2),transparent_30%),radial-gradient(circle_at_85%_85%,rgba(35,93,230,0.2),transparent_35%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 blueprint-grid" />
      <Card className="relative w-full max-w-md overflow-hidden border-white/10 bg-slate-950/85 text-white shadow-2xl backdrop-blur-xl">
        <div className="h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-cyan-400" />
        <CardContent className="p-7 sm:p-9">
          <Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-full max-w-[240px]" />
          <div className="mt-8 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-300/20"><ShieldCheck className="size-5" /></span>
            <div><h1 className="text-2xl font-semibold tracking-tight">Controle da plataforma</h1><p className="mt-1 text-sm text-slate-400">Acesso exclusivo do superadministrador.</p></div>
          </div>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div><label htmlFor="superadmin-email" className="mb-2 block text-sm font-medium text-slate-200">E-mail</label><Input id="superadmin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required className="h-11 border-white/10 bg-white/[0.06] text-white placeholder:text-slate-600" /></div>
            <div><label htmlFor="superadmin-password" className="mb-2 block text-sm font-medium text-slate-200">Senha</label><div className="relative"><Input id="superadmin-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="h-11 border-white/10 bg-white/[0.06] pr-11 text-white placeholder:text-slate-600" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
            {error ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
            <Button type="submit" disabled={submitting} className="h-11 w-full rounded-xl bg-cyan-400 text-slate-950 hover:bg-cyan-300">{submitting ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Entrar como superadmin</Button>
          </form>
          <Link href="/" className="mt-6 block text-center text-sm text-slate-500 transition-colors hover:text-cyan-300">Voltar ao acesso da empresa</Link>
        </CardContent>
      </Card>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: number }) {
  return <Card className="workspace-card"><CardContent className="flex items-center gap-4 p-5"><span className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-blue-600"><Icon className="size-5" /></span><div><p className="metric-number text-3xl font-semibold text-slate-950">{value}</p><p className="text-sm text-slate-500">{label}</p></div></CardContent></Card>;
}

function InvitationsPanel({ organizations }: { organizations: Overview["organizations"] }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [latestLink, setLatestLink] = useState("");
  const [copied, setCopied] = useState(false);

  const loadInvitations = useCallback(async () => {
    const result = await api<{ invitations: Invitation[] }>("/api/superadmin/invitations");
    setInvitations(result.invitations);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadInvitations().catch(() => undefined); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadInvitations]);

  async function createInvitation(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setLatestLink(""); setCopied(false);
    try {
      const result = await api<{ invitationPath: string }>("/api/superadmin/invitations", {
        method: "POST",
        body: JSON.stringify({ organizationId, email, role, expiresInDays: 7 }),
      });
      setLatestLink(`${window.location.origin}${result.invitationPath}`);
      setEmail("");
      await loadInvitations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o convite.");
    } finally { setSaving(false); }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(latestLink);
    setCopied(true);
  }

  async function revoke(invitationId: string) {
    await api(`/api/superadmin/invitations/${invitationId}`, { method: "DELETE" });
    await loadInvitations();
  }

  return <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.4fr]"><Card className="workspace-card"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><MailPlus className="size-5 text-blue-600" />Liberar novo acesso</CardTitle></CardHeader><CardContent><form onSubmit={createInvitation} className="space-y-4"><div><label className="mb-2 block text-sm font-medium" htmlFor="invite-company">Empresa</label><Select value={organizationId} onValueChange={setOrganizationId}><SelectTrigger id="invite-company" className="h-11 w-full"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger><SelectContent>{organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}</SelectContent></Select></div><div><label className="mb-2 block text-sm font-medium" htmlFor="invite-email">E-mail do usuário</label><Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-11" placeholder="nome@empresa.com" /></div><div><label className="mb-2 block text-sm font-medium" htmlFor="invite-role">Perfil de acesso</label><Select value={role} onValueChange={setRole}><SelectTrigger id="invite-role" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="member">Membro</SelectItem><SelectItem value="manager">Gestor</SelectItem><SelectItem value="admin">Administrador</SelectItem></SelectContent></Select></div>{error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}<Button type="submit" disabled={saving || !organizationId} className="h-11 w-full">{saving ? <LoaderCircle className="animate-spin" /> : <MailPlus />}Gerar link de convite</Button></form>{latestLink ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="flex items-center gap-2 text-sm font-medium text-emerald-800"><Check className="size-4" />Link criado</p><p className="mt-2 break-all text-xs text-emerald-700">{latestLink}</p><Button type="button" size="sm" variant="outline" onClick={() => void copyLink()} className="mt-3 border-emerald-300 bg-white text-emerald-800">{copied ? <Check /> : <Copy />}{copied ? "Copiado" : "Copiar link"}</Button></div> : null}</CardContent></Card><Card className="overflow-hidden workspace-card"><CardHeader className="border-b"><CardTitle className="text-lg">Convites enviados</CardTitle></CardHeader><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="pl-5">Usuário</TableHead><TableHead>Empresa</TableHead><TableHead>Perfil</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader><TableBody>{invitations.length ? invitations.map((invitation) => <TableRow key={invitation.id}><TableCell className="pl-5"><p className="font-medium">{invitation.email}</p><p className="text-xs text-slate-500">Expira em {new Date(invitation.expiresAt).toLocaleDateString("pt-BR")}</p></TableCell><TableCell>{invitation.organizationName}</TableCell><TableCell>{roleLabels[invitation.role] ?? invitation.role}</TableCell><TableCell><Badge variant="outline">{invitation.status === "pending" ? "Pendente" : invitation.status === "accepted" ? "Aceito" : invitation.status === "expired" ? "Expirado" : "Revogado"}</Badge></TableCell><TableCell className="text-right">{invitation.status === "pending" ? <Button type="button" size="sm" variant="ghost" onClick={() => void revoke(invitation.id)} className="text-red-600 hover:text-red-700"><XCircle />Revogar</Button> : null}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-32 text-center text-slate-500">Nenhum convite criado.</TableCell></TableRow>}</TableBody></Table></div></Card></div>;
}

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Overview>("/api/superadmin/overview").then(setOverview).catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar."));
  }, []);

  return (
    <main className="min-h-svh bg-slate-100">
      <header className="border-b border-slate-800 bg-[#071426] text-white shadow-xl">
        <div className="mx-auto flex max-w-[1480px] items-center gap-4 px-5 py-4 sm:px-8">
          <Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-[180px]" />
          <Badge className="ml-2 border-cyan-300/20 bg-cyan-300/10 text-cyan-200">Superadmin</Badge>
          <div className="ml-auto hidden text-right sm:block"><p className="text-sm font-medium">{session.email}</p><p className="text-xs text-slate-400">Sessão protegida</p></div>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-300 hover:bg-white/10 hover:text-white"><LogOut />Sair</Button>
        </div>
      </header>
      <div className="blueprint-grid mx-auto max-w-[1480px] px-5 py-7 sm:px-8 sm:py-10">
        <div className="mb-7"><div className="flex items-center gap-2 text-sm font-medium text-cyan-700"><ShieldCheck className="size-4" />Visão global protegida</div><h1 className="display-heading mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Controle da plataforma</h1><p className="mt-2 text-slate-600">Acompanhe as empresas e o uso real do Nexo Obra.</p></div>
        {error ? <Card className="border-red-200 bg-red-50 p-5 text-red-700">{error}</Card> : !overview ? <Card className="grid min-h-60 place-items-center"><LoaderCircle className="size-6 animate-spin text-blue-600" /></Card> : <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={Building2} label="Empresas" value={overview.totals.organizations} /><Metric icon={Users} label="Membros ativos" value={overview.totals.members} /><Metric icon={Target} label="Clientes" value={overview.totals.clients} /><Metric icon={FolderKanban} label="Projetos e obras" value={overview.totals.projects} /><Metric icon={ListChecks} label="Tarefas abertas" value={overview.totals.open_tasks} /></div>
          <InvitationsPanel organizations={overview.organizations} />
          <Card className="mt-6 overflow-hidden workspace-card"><CardHeader className="border-b bg-white"><CardTitle className="text-lg">Empresas cadastradas</CardTitle></CardHeader><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="pl-6">Empresa</TableHead><TableHead>Membros</TableHead><TableHead>Clientes</TableHead><TableHead>Projetos</TableHead><TableHead>Tarefas abertas</TableHead><TableHead>Criada em</TableHead></TableRow></TableHeader><TableBody>{overview.organizations.length ? overview.organizations.map((organization) => <TableRow key={organization.id}><TableCell className="pl-6"><p className="font-medium text-slate-900">{organization.name}</p><p className="text-xs text-slate-500">{organization.slug}</p></TableCell><TableCell>{organization.members}</TableCell><TableCell>{organization.clients}</TableCell><TableCell>{organization.projects}</TableCell><TableCell>{organization.openTasks}</TableCell><TableCell>{new Date(organization.createdAt).toLocaleDateString("pt-BR")}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-32 text-center text-slate-500">Nenhuma empresa cadastrada.</TableCell></TableRow>}</TableBody></Table></div></Card>
        </>}
      </div>
    </main>
  );
}

export function SuperAdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const loadSession = useCallback(async () => {
    try { setSession(await api<Session>("/api/superadmin/session")); }
    catch { setSession(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSession(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSession]);
  async function logout() {
    await api("/api/superadmin/session", { method: "DELETE" }).catch(() => undefined);
    setSession(null);
  }
  if (loading) return <main className="grid min-h-svh place-items-center bg-[#06111f]"><LoaderCircle className="size-7 animate-spin text-cyan-300" /></main>;
  if (!session) return <Login onAuthenticated={setSession} />;
  return <Dashboard session={session} onLogout={() => void logout()} />;
}
