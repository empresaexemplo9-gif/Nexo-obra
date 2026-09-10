"use client";

import { BrandLogo } from "@/components/brand-logo";
import { PlatformControl } from "@/components/platform-control";
import { UsageWorkspace } from "@/components/usage-workspace";
import { PLATFORM_BUILD, PLATFORM_BUILT_AT } from "@/lib/build-info";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  Database,
  DoorOpen,
  GitCommitHorizontal,
  Eye,
  EyeOff,
  FolderKanban,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LogOut,
  MailPlus,
  Plus,
  ShieldCheck,
  Wrench,
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
  maintenance: { id: string; ready: boolean; members: number; projects: number; openTasks: number; lastEntryAt: number | null };
};
type Invitation = {
  id: string; organizationId: string; organizationName: string; email: string; role: string;
  expiresAt: number; acceptedAt: number | null; createdAt: number; status: "pending" | "accepted" | "expired" | "revoked";
};
const roleLabels: Record<string, string> = { owner: "Contratante · proprietário", admin: "Administrador", manager: "Gestor", member: "Membro" };

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
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-primary p-5">

      <Card className="relative w-full max-w-md overflow-hidden border-white/10 bg-primary text-white shadow-none ">
        <div className="h-px bg-border" />
        <CardContent className="p-7 sm:p-9">
          <BrandLogo variant="stacked" dark className="h-auto w-full max-w-[240px]" />
          <div className="mt-8 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md bg-hoikos-400/10 text-hoikos-300 ring-1 ring-hoikos-300/20"><ShieldCheck className="size-5" /></span>
            <div><h1 className="display-heading text-3xl">Controle da plataforma</h1><p className="mt-1 text-sm text-hoikos-500">Acesso exclusivo do superadministrador.</p></div>
          </div>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div><label htmlFor="superadmin-email" className="mb-2 block text-sm font-medium text-hoikos-200">E-mail</label><Input id="superadmin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required className="h-11 border-white/10 bg-white/[0.06] text-white placeholder:text-hoikos-600" /></div>
            <div><label htmlFor="superadmin-password" className="mb-2 block text-sm font-medium text-hoikos-200">Senha</label><div className="relative"><Input id="superadmin-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="h-11 border-white/10 bg-white/[0.06] pr-11 text-white placeholder:text-hoikos-600" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-hoikos-500 hover:text-white">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
            {error ? <p role="alert" className="rounded-md border border-hoikos-400/20 bg-hoikos-400/10 px-3 py-2 text-sm text-hoikos-200">{error}</p> : null}
            <Button type="submit" disabled={submitting} className="h-11 w-full rounded-md bg-hoikos-400 text-hoikos-950 hover:bg-hoikos-200">{submitting ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Entrar como superadmin</Button>
          </form>
          <Link href="/" className="mt-6 block text-center text-sm text-hoikos-500 transition-colors hover:text-hoikos-300">Voltar ao acesso da empresa</Link>
        </CardContent>
      </Card>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: number }) {
  return <Card className="workspace-card"><CardContent className="flex items-center gap-4 p-5"><span className="grid size-11 place-items-center rounded-md bg-hoikos-50 text-hoikos-600"><Icon className="size-5" /></span><div><p className="metric-number text-3xl font-semibold text-hoikos-950">{value}</p><p className="text-sm text-hoikos-500">{label}</p></div></CardContent></Card>;
}

function InvitationsPanel({ organizations }: { organizations: Overview["organizations"] }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const role = "owner";
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

  return <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.4fr]"><Card className="workspace-card"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><MailPlus className="size-5 text-hoikos-600" />Liberar acesso do contratante</CardTitle><p className="text-sm leading-6 text-hoikos-500">Este link cria o proprietário da empresa. Depois, ele mesmo libera colaboradores e prestadores com permissões específicas.</p></CardHeader><CardContent><form onSubmit={createInvitation} className="space-y-4"><div><label className="mb-2 block text-sm font-medium" htmlFor="invite-company">Empresa</label><Select value={organizationId} onValueChange={setOrganizationId}><SelectTrigger id="invite-company" className="h-11 w-full"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger><SelectContent>{organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}</SelectContent></Select></div><div><label className="mb-2 block text-sm font-medium" htmlFor="invite-email">E-mail do contratante</label><Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-11" placeholder="responsavel@empresa.com" /></div><div className="rounded-md border border-hoikos-100 bg-hoikos-50 p-3 text-sm text-hoikos-900"><strong>Perfil:</strong> Contratante · proprietário</div>{error ? <p role="alert" className="text-sm text-hoikos-600">{error}</p> : null}<Button type="submit" disabled={saving || !organizationId} className="h-11 w-full">{saving ? <LoaderCircle className="animate-spin" /> : <MailPlus />}Gerar link principal</Button></form>{latestLink ? <div className="mt-5 rounded-md border border-hoikos-200 bg-hoikos-50 p-4"><p className="flex items-center gap-2 text-sm font-medium text-hoikos-800"><Check className="size-4" />Link criado</p><p className="mt-2 break-all text-xs text-hoikos-700">{latestLink}</p><Button type="button" size="sm" variant="outline" onClick={() => void copyLink()} className="mt-3 border-hoikos-300 bg-white text-hoikos-800">{copied ? <Check /> : <Copy />}{copied ? "Copiado" : "Copiar link"}</Button></div> : null}</CardContent></Card><Card className="overflow-hidden workspace-card"><CardHeader className="border-b"><CardTitle className="text-lg">Convites de contratantes</CardTitle></CardHeader><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-hoikos-50"><TableHead className="pl-5">Usuário</TableHead><TableHead>Empresa</TableHead><TableHead>Perfil</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader><TableBody>{invitations.length ? invitations.map((invitation) => <TableRow key={invitation.id}><TableCell className="pl-5"><p className="font-medium">{invitation.email}</p><p className="text-xs text-hoikos-500">Expira em {new Date(invitation.expiresAt).toLocaleDateString("pt-BR")}</p></TableCell><TableCell>{invitation.organizationName}</TableCell><TableCell>{roleLabels[invitation.role] ?? invitation.role}</TableCell><TableCell><Badge variant="outline">{invitation.status === "pending" ? "Pendente" : invitation.status === "accepted" ? "Aceito" : invitation.status === "expired" ? "Expirado" : "Revogado"}</Badge></TableCell><TableCell className="text-right">{invitation.status === "pending" ? <Button type="button" size="sm" variant="ghost" onClick={() => void revoke(invitation.id)} className="text-hoikos-600 hover:text-hoikos-700"><XCircle />Revogar</Button> : null}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-32 text-center text-hoikos-500">Nenhum convite criado.</TableCell></TableRow>}</TableBody></Table></div></Card></div>;
}

function NewCompanyPanel({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setCreated("");
    try {
      const result = await api<{ organization: { name: string } }>("/api/superadmin/organizations", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCreated(result.organization.name);
      setName("");
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível cadastrar a empresa.");
    } finally { setSaving(false); }
  }

  return <Card className="workspace-card"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Building2 className="size-5 text-hoikos-600" />Cadastrar empresa</CardTitle><p className="text-sm leading-6 text-hoikos-500">A empresa nasce vazia. Você já pode operá-la e o convite principal define o contratante proprietário.</p></CardHeader><CardContent><form onSubmit={submit} className="space-y-4"><div><label className="mb-2 block text-sm font-medium" htmlFor="new-company">Nome da empresa</label><Input id="new-company" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} className="h-11" placeholder="Escritório Exemplo" /></div>{error ? <p role="alert" className="text-sm text-hoikos-600">{error}</p> : null}{created ? <p className="flex items-center gap-2 text-sm text-hoikos-800"><Check className="size-4" />{created} cadastrada.</p> : null}<Button type="submit" disabled={saving} className="h-11 w-full">{saving ? <LoaderCircle className="animate-spin" /> : <Plus />}Cadastrar empresa</Button></form></CardContent></Card>;
}

type MigrationStatus = { applied: Array<{ id: string; appliedAt: number }>; pending: string[]; total: number };

// Qual versão está servindo. O domínio público reescreve as rotas para outro alvo de
// publicação, então uma versão antiga no ar não tem sintoma nenhum além de "não mudou
// nada". Este bloco dá o sintoma.
function BuildPanel() {
  // O selo é uma constante do bundle, então a data não muda entre renders.
  const builtAt = useMemo(() => (PLATFORM_BUILT_AT ? new Date(PLATFORM_BUILT_AT) : null), []);
  // A idade entra por estado: comparar com Date.now() durante o render é impuro.
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    if (!builtAt) return;
    const timer = window.setTimeout(() => {
      setDays(Math.floor((Date.now() - builtAt.getTime()) / 86_400_000));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [builtAt]);
  const stale = days !== null && days >= 2;

  return <Card className={stale ? "border-hoikos-400 bg-hoikos-50" : "workspace-card"}>
    <CardContent className="flex flex-wrap items-center gap-3 p-4">
      <GitCommitHorizontal className={`size-5 ${stale ? "text-hoikos-700" : "text-hoikos-600"}`} />
      <p className="min-w-0 flex-1 text-sm text-hoikos-700">
        Versão no ar: <strong className="font-mono">{PLATFORM_BUILD}</strong>
        {builtAt ? ` · compilada em ${builtAt.toLocaleString("pt-BR")}` : ""}
        {stale ? ` · há ${days} dia(s)` : ""}
      </p>
      {stale ? <p className="w-full text-sm leading-6 text-hoikos-800">
        Se você publicou alterações depois dessa data, elas não estão neste build. O domínio público apenas
        reescreve as rotas para o alvo de publicação; ele não compila o repositório. Republique o projeto para
        o código novo entrar no ar.
      </p> : null}
    </CardContent>
  </Card>;
}

// O banco desatualizado derruba o resto do painel, então este bloco é carregado por
// conta própria e aparece mesmo quando os indicadores falham.
function DatabasePanel({ status, onApplied }: { status: MigrationStatus; onApplied: () => Promise<void> }) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);

  async function apply() {
    setApplying(true); setError("");
    try {
      const result = await api<{ applied: Array<{ id: string }> }>("/api/superadmin/migrations", { method: "POST" });
      setDone(result.applied.length);
      await onApplied();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o banco.");
    } finally { setApplying(false); }
  }

  if (!status.pending.length) {
    return <Card className="workspace-card"><CardContent className="flex flex-wrap items-center gap-3 p-4">
      <Database className="size-5 text-hoikos-600" />
      <p className="min-w-0 flex-1 text-sm text-hoikos-600">
        Banco de dados em dia: {status.applied.length} de {status.total} atualizações aplicadas.
        {done ? ` ${done} aplicada(s) agora.` : ""}
      </p>
    </CardContent></Card>;
  }

  return <Card className="border-hoikos-400 bg-hoikos-50">
    <CardHeader className="gap-2">
      <CardTitle className="flex items-center gap-2 text-lg"><Database className="size-5 text-hoikos-700" />Banco de dados desatualizado</CardTitle>
      <p className="text-sm leading-6 text-hoikos-800">
        Faltam {status.pending.length} de {status.total} atualizações de esquema. Enquanto isso, as áreas que
        dependem das tabelas novas — planilhas, lembretes, metas e tempo de uso — respondem erro. Aplicar é seguro:
        o que já existe é reconhecido e nada é recriado.
      </p>
    </CardHeader>
    <CardContent className="space-y-3">
      <p className="break-all text-xs text-hoikos-600">{status.pending.join(", ")}</p>
      {error ? <p role="alert" className="text-sm font-medium text-hoikos-800">{error}</p> : null}
      <Button onClick={() => void apply()} disabled={applying} className="h-11 w-full sm:w-auto">
        {applying ? <LoaderCircle className="animate-spin" /> : <Database />}Atualizar banco de dados
      </Button>
    </CardContent>
  </Card>;
}

function MaintenancePanel({ maintenance }: { maintenance: Overview["maintenance"] }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setOpening(true); setError("");
    try {
      await api("/api/superadmin/maintenance", { method: "POST" });
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o ambiente de manutenção.");
      setOpening(false);
    }
  }

  return <Card className="workspace-card"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Wrench className="size-5 text-hoikos-600" />Ambiente de manutenção</CardTitle><p className="text-sm leading-6 text-hoikos-500">O administrador de manutenção continua com login próprio em <span className="whitespace-nowrap">/manutencao</span>, confinado a este ambiente. Você entra aqui pela sessão da plataforma, sem a senha dele, e mantém os recursos que só o superadmin tem: cadastrar empresas, controlar acessos, assinaturas e trocar de empresa sem sair.</p></CardHeader><CardContent className="space-y-4">{maintenance.ready ? <dl className="grid grid-cols-3 gap-3 text-sm"><div><dt className="text-hoikos-500">Membros</dt><dd className="metric-number text-2xl font-semibold text-hoikos-950">{maintenance.members}</dd></div><div><dt className="text-hoikos-500">Trabalhos</dt><dd className="metric-number text-2xl font-semibold text-hoikos-950">{maintenance.projects}</dd></div><div><dt className="text-hoikos-500">Tarefas abertas</dt><dd className="metric-number text-2xl font-semibold text-hoikos-950">{maintenance.openTasks}</dd></div></dl> : <p className="rounded-md border border-hoikos-100 bg-hoikos-50 p-3 text-sm text-hoikos-900">O ambiente ainda não foi criado. Ele nasce vazio no primeiro acesso, seu ou do administrador de manutenção.</p>}<p className="text-sm text-hoikos-500">{maintenance.lastEntryAt ? `Última entrada da plataforma em ${new Date(maintenance.lastEntryAt).toLocaleString("pt-BR")}.` : "Nenhuma entrada da plataforma registrada."}</p>{error ? <p role="alert" className="text-sm text-hoikos-600">{error}</p> : null}<Button type="button" onClick={() => void open()} disabled={opening} className="h-11 w-full">{opening ? <LoaderCircle className="animate-spin" /> : <Wrench />}Abrir ambiente de manutenção</Button></CardContent></Card>;
}

function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [database, setDatabase] = useState<MigrationStatus | null>(null);
  const [error, setError] = useState("");
  const [entering, setEntering] = useState("");

  const loadOverview = useCallback(async () => {
    setOverview(await api<Overview>("/api/superadmin/overview"));
  }, []);

  const loadDatabase = useCallback(async () => {
    try { setDatabase(await api<MigrationStatus>("/api/superadmin/migrations")); }
    catch { setDatabase(null); }
  }, []);

  const reload = useCallback(async () => {
    // Sem limpar, o erro da carga anterior sobreviveria à correção do banco.
    setError("");
    await loadDatabase();
    await loadOverview().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar."));
  }, [loadDatabase, loadOverview]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDatabase();
      void loadOverview().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao carregar."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDatabase, loadOverview]);

  async function openCompany(organizationId: string) {
    setEntering(organizationId); setError("");
    try {
      await api("/api/session", { method: "POST", body: JSON.stringify({ organizationId }) });
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a empresa.");
      setEntering("");
    }
  }

  return (
    <main className="min-h-svh bg-hoikos-100">
      <header className="border-b border-hoikos-800 bg-primary text-white shadow-none">
        <div className="mx-auto flex max-w-[1480px] items-center gap-4 px-5 py-4 sm:px-8">
          <BrandLogo dark className="h-auto w-[180px]" />
          <Badge className="ml-2 border-hoikos-300/20 bg-hoikos-300/10 text-hoikos-200">Superadmin</Badge>
          <div className="ml-auto hidden text-right sm:block"><p className="text-sm font-medium">{session.email}</p><p className="text-xs text-hoikos-500">Sessão protegida</p></div>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-hoikos-300 hover:bg-white/10 hover:text-white"><LogOut />Sair</Button>
        </div>
      </header>
      <div className=" mx-auto max-w-[1480px] px-5 py-7 sm:px-8 sm:py-10">
        <div className="mb-7"><div className="flex items-center gap-2 text-sm font-medium text-hoikos-700"><ShieldCheck className="size-4" />Visão global protegida</div><h1 className="display-heading mt-2 text-4xl text-hoikos-950 sm:text-5xl">Controle da plataforma</h1><p className="mt-2 text-hoikos-600">Acompanhe os indicadores da plataforma e abra qualquer empresa com leitura e edição totais. Cada entrada fica registrada na auditoria da empresa.</p></div>
        <div className="mb-4"><BuildPanel /></div>
        {database ? <div className="mb-6"><DatabasePanel status={database} onApplied={reload} /></div> : null}
        {error && !database?.pending.length ? <Card className="border-hoikos-200 bg-hoikos-50 p-5 text-hoikos-700">{error}</Card>
          : error ? null
          : !overview ? <Card className="grid min-h-60 place-items-center"><LoaderCircle className="size-6 animate-spin text-hoikos-600" /></Card> : <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={Building2} label="Empresas" value={overview.totals.organizations} /><Metric icon={Users} label="Membros ativos" value={overview.totals.members} /><Metric icon={Target} label="Clientes" value={overview.totals.clients} /><Metric icon={FolderKanban} label="Projetos e obras" value={overview.totals.projects} /><Metric icon={ListChecks} label="Tarefas abertas" value={overview.totals.open_tasks} /></div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.4fr]"><NewCompanyPanel onCreated={loadOverview} /><div className="grid gap-6"><Card className="workspace-card"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><DoorOpen className="size-5 text-hoikos-600" />Operar uma empresa</CardTitle><p className="text-sm leading-6 text-hoikos-500">Abra a empresa pelo botão da tabela abaixo. Você entra com permissão total em todos os módulos, sem depender de convite ou de assinatura confirmada.</p></CardHeader></Card><MaintenancePanel maintenance={overview.maintenance} /></div></div>
          <InvitationsPanel organizations={overview.organizations} />
          <PlatformControl organizations={overview.organizations} maintenanceId={overview.maintenance.ready ? overview.maintenance.id : undefined} />
          {overview.organizations.length ? <section className="mt-6 space-y-4"><h2 className="text-xl font-semibold">Tempo online de todos os acessos</h2><UsageWorkspace /></section> : null}
          <Card className="mt-6 overflow-hidden workspace-card"><CardHeader className="border-b bg-white"><CardTitle className="text-lg">Empresas cadastradas</CardTitle></CardHeader><div className="overflow-x-auto"><Table><TableHeader><TableRow className="bg-hoikos-50"><TableHead className="pl-6">Empresa</TableHead><TableHead>Membros</TableHead><TableHead>Clientes</TableHead><TableHead>Projetos</TableHead><TableHead>Tarefas abertas</TableHead><TableHead>Criada em</TableHead><TableHead className="text-right pr-5">Ação</TableHead></TableRow></TableHeader><TableBody>{overview.organizations.length ? overview.organizations.map((organization) => <TableRow key={organization.id}><TableCell className="pl-6"><p className="font-medium text-hoikos-900">{organization.name}</p><p className="text-xs text-hoikos-500">{organization.slug}</p></TableCell><TableCell>{organization.members}</TableCell><TableCell>{organization.clients}</TableCell><TableCell>{organization.projects}</TableCell><TableCell>{organization.openTasks}</TableCell><TableCell>{new Date(organization.createdAt).toLocaleDateString("pt-BR")}</TableCell><TableCell className="pr-5 text-right"><Button type="button" size="sm" variant="outline" disabled={Boolean(entering)} onClick={() => void openCompany(organization.id)}>{entering === organization.id ? <LoaderCircle className="animate-spin" /> : <DoorOpen />}Abrir empresa</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={7} className="h-32 text-center text-hoikos-500">Nenhuma empresa cadastrada. Use “Cadastrar empresa” para começar.</TableCell></TableRow>}</TableBody></Table></div></Card>
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
  if (loading) return <main className="grid min-h-svh place-items-center bg-primary"><LoaderCircle className="size-7 animate-spin text-hoikos-300" /></main>;
  if (!session) return <Login onAuthenticated={setSession} />;
  return <Dashboard session={session} onLogout={() => void logout()} />;
}
