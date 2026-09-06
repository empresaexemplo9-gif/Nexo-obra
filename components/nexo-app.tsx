"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Building2,
  Calculator,
  CalendarRange,
  Check,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  Database,
  Eye,
  EyeOff,
  Files,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  LogOut,
  KeyRound,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";

type ModuleId = "overview" | "projects" | "works" | "budgets" | "schedule" | "crm" | "finance" | "team" | "tasks" | "files";
type CreateKind = "client" | "project" | "task";

type Organization = { id: string; name: string; slug: string; timezone: string; role?: string };
type SessionData = {
  authenticated: boolean;
  needsOrganization: boolean;
  signInPath?: string;
  user?: { id: string; email: string; displayName: string };
  member?: { id: string; role: string };
  organization?: Organization;
  organizations: Organization[];
};
type Client = { id: string; name: string; email: string | null; phone: string | null; document: string | null; updatedAt: string };
type Project = {
  id: string; clientId: string | null; clientName: string | null; code: string; name: string;
  kind: "project" | "work"; status: string; phase: string; progressPercent: number;
  ownerName: string | null; targetDate: string | null; budgetCents: number;
};
type Task = {
  id: string; projectId: string; projectName: string; title: string; status: string;
  priority: string; assigneeName: string | null; dueAt: string | null;
};
type Member = { id: string; name: string; email: string; role: string; weeklyCapacityMinutes: number };
type FinancialSummary = {
  currentBalance: number; receivables: number; payables: number; projected30d: number;
  overdueReceivables: number; updatedAt: string; source: "drap";
};

class RequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) throw new RequestError(body.error ?? "Não foi possível concluir a operação.", body.code);
  return body as T;
}

const moduleTitles: Record<ModuleId, { title: string; description: string }> = {
  overview: { title: "Visão geral", description: "Prioridades e andamento da empresa atual." },
  projects: { title: "Projetos", description: "Projetos reais, clientes, etapas e responsáveis." },
  works: { title: "Obras", description: "Obras em execução e seus avanços." },
  budgets: { title: "Orçamentos", description: "Custos, BDI, margem e aprovação." },
  schedule: { title: "Cronograma", description: "Prazos ligados a projetos e tarefas." },
  crm: { title: "Clientes", description: "Base de clientes da empresa atual." },
  finance: { title: "Financeiro", description: "Informações oficiais vindas da Drap." },
  team: { title: "Equipe", description: "Pessoas com acesso a esta empresa." },
  tasks: { title: "Tarefas", description: "Execução organizada por prioridade e projeto." },
  files: { title: "Arquivos", description: "Documentos vinculados aos trabalhos." },
};

const roleLabels: Record<string, string> = {
  owner: "Proprietário", admin: "Administrador", manager: "Gestor", member: "Membro", partner: "Parceiro", client: "Cliente",
};
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

function Brand({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  if (compact) return <span className="grid size-10 place-items-center rounded-xl bg-cyan-500 font-black text-slate-950 shadow-lg">D</span>;
  return (
    <div className={`flex items-center ${dark ? "rounded-xl bg-slate-950/35 px-2 py-2" : ""}`}>
      <Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-full max-w-[220px]" />
    </div>
  );
}

function LoadingScreen() {
  return <main className="grid min-h-svh place-items-center bg-slate-950"><div className="flex flex-col items-center gap-5"><Brand dark /><LoaderCircle className="size-6 animate-spin text-cyan-400" /><p className="text-sm text-slate-400">Abrindo sua empresa…</p></div></main>;
}

function AccessScreen({ signInPath = "/signin-with-chatgpt?return_to=%2F" }: { signInPath?: string }) {
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");

  async function submitSuperadmin(event: FormEvent) {
    event.preventDefault();
    setAdminLoading(true);
    setAdminError("");
    try {
      await requestJson("/api/superadmin/session", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      window.location.assign("/superadmin");
    } catch (cause) {
      setAdminError(cause instanceof Error ? cause.message : "Não foi possível entrar.");
    } finally {
      setAdminLoading(false);
    }
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[#06111f] p-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(13,205,219,0.18),transparent_32%),radial-gradient(circle_at_80%_80%,rgba(37,99,235,0.16),transparent_35%)]" />
      <Card className="relative w-full max-w-lg border-white/10 bg-slate-950/80 text-white shadow-2xl backdrop-blur-xl">
        <CardContent className="p-7 sm:p-9">
          <Brand dark />
          <h1 className="mt-8 text-3xl font-semibold tracking-tight">Acesse o Nexo Obra</h1>
          <p className="mt-3 text-base leading-7 text-slate-300">Escolha o tipo de acesso para continuar.</p>
          <p className="mt-7 text-sm font-medium text-slate-200">Conta da empresa</p>
          <Button asChild className="mt-3 h-11 w-full rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400">
            <a href={signInPath} target="_top">Entrar com ChatGPT</a>
          </Button>
          <div className="my-7 flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-600"><span className="h-px flex-1 bg-white/10" />Superadmin<span className="h-px flex-1 bg-white/10" /></div>
          <form onSubmit={submitSuperadmin} className="space-y-4">
            <div><label htmlFor="initial-superadmin-email" className="mb-2 block text-sm font-medium text-slate-200">E-mail</label><Input id="initial-superadmin-email" type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} autoComplete="username" required className="h-11 border-white/10 bg-white/[0.06] text-white placeholder:text-slate-600" /></div>
            <div><label htmlFor="initial-superadmin-password" className="mb-2 block text-sm font-medium text-slate-200">Senha</label><div className="relative"><Input id="initial-superadmin-password" type={showAdminPassword ? "text" : "password"} value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="current-password" required className="h-11 border-white/10 bg-white/[0.06] pr-11 text-white placeholder:text-slate-600" /><button type="button" onClick={() => setShowAdminPassword((value) => !value)} aria-label={showAdminPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">{showAdminPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
            {adminError ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{adminError}</p> : null}
            <Button type="submit" variant="outline" disabled={adminLoading} className="h-11 w-full rounded-xl border-cyan-300/25 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20 hover:text-white">{adminLoading ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Entrar como superadmin</Button>
          </form>
          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500"><ShieldCheck className="size-4" />Acesso protegido e dados separados por empresa.</p>
        </CardContent>
      </Card>
    </main>
  );
}

function OrganizationForm({ onCreated, embedded = false }: { onCreated: () => Promise<void> | void; embedded?: boolean }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await requestJson("/api/onboarding", { method: "POST", body: JSON.stringify({ organizationName: name }) });
      toast.success("Empresa criada", { description: `${name} já está pronta para receber dados reais.` });
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a empresa."); }
    finally { setSaving(false); }
  }
  const form = (
    <form onSubmit={submit} className="space-y-5">
      <div><label htmlFor="organization-name" className="mb-2 block text-sm font-medium">Nome da empresa</label><Input id="organization-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Meu Escritório de Arquitetura" minLength={2} required className="h-11" /></div>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" disabled={saving || name.trim().length < 2} className="h-11 w-full rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400">{saving ? <LoaderCircle className="animate-spin" /> : <Building2 />}Criar empresa</Button>
    </form>
  );
  if (embedded) return form;
  return (
    <main className="grid min-h-svh place-items-center bg-slate-50 p-5">
      <Card className="w-full max-w-lg border-slate-200 shadow-xl"><CardHeader><Brand /><CardTitle className="pt-6 text-2xl">Crie sua primeira empresa</CardTitle><p className="text-sm leading-6 text-slate-500">A conta começa vazia. Você adiciona apenas os dados reais da sua operação.</p></CardHeader><CardContent>{form}</CardContent></Card>
    </main>
  );
}

function Kpi({ icon: Icon, label, value, detail, tone = "blue" }: { icon: LucideIcon; label: string; value: string; detail: string; tone?: "blue" | "amber" | "emerald" }) {
  const tones = { blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700", emerald: "bg-emerald-50 text-emerald-700" };
  return <Card className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-slate-500">{label}</p><p className="metric-number mt-2 text-2xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><span className={`grid size-10 place-items-center rounded-xl ${tones[tone]}`}><Icon className="size-5" /></span></div></Card>;
}

function PageIntro({ module, action, actionLabel }: { module: ModuleId; action?: () => void; actionLabel?: string }) {
  const copy = moduleTitles[module];
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Empresa atual</p><h1 className="display-heading mt-2 text-3xl font-semibold text-slate-950">{copy.title}</h1><p className="mt-2 text-sm text-slate-500">{copy.description}</p></div>{action ? <Button onClick={action} className="rounded-xl"><Plus />{actionLabel}</Button> : null}</div>;
}

function HonestEmpty({ icon: Icon, title, description, action, actionLabel }: { icon: LucideIcon; title: string; description: string; action?: () => void; actionLabel?: string }) {
  return <Card><Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon" className="bg-blue-50 text-blue-700"><Icon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action ? <EmptyContent><Button onClick={action}><Plus />{actionLabel}</Button></EmptyContent> : null}</Empty></Card>;
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { active: "Em andamento", on_hold: "Pausado", completed: "Concluído", archived: "Arquivado", todo: "A fazer", in_progress: "Em execução", blocked: "Bloqueada", done: "Concluída" };
  const color = status === "completed" || status === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "blocked" || status === "on_hold" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700";
  return <Badge variant="outline" className={color}>{labels[status] ?? status}</Badge>;
}

function ProjectTable({ projects, query }: { projects: Project[]; query: string }) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const rows = projects.filter((project) => !normalized || `${project.name} ${project.clientName ?? ""} ${project.code}`.toLocaleLowerCase("pt-BR").includes(normalized));
  return <Card className="overflow-hidden"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="pl-5">Trabalho</TableHead><TableHead>Etapa</TableHead><TableHead>Avanço</TableHead><TableHead>Prazo</TableHead><TableHead className="pr-5 text-right">Situação</TableHead></TableRow></TableHeader><TableBody>{rows.map((project) => <TableRow key={project.id}><TableCell className="pl-5"><p className="font-medium text-slate-900">{project.name}</p><p className="text-xs text-slate-500">{project.code} · {project.clientName ?? "Sem cliente"}</p></TableCell><TableCell>{project.phase}</TableCell><TableCell><div className="flex min-w-32 items-center gap-2"><Progress value={project.progressPercent} className="h-1.5" /><span className="text-xs tabular-nums">{project.progressPercent}%</span></div></TableCell><TableCell>{project.targetDate ? new Date(`${project.targetDate}T12:00:00`).toLocaleDateString("pt-BR") : "Sem prazo"}</TableCell><TableCell className="pr-5 text-right"><StatusBadge status={project.status} /></TableCell></TableRow>)}</TableBody></Table></Card>;
}

function QuickCreate({ open, onOpenChange, projects, clients, initialKind, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; projects: Project[]; clients: Client[]; initialKind: CreateKind; onCreated: () => Promise<void> }) {
  const [kind, setKind] = useState<CreateKind>(initialKind);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (kind === "client") await requestJson("/api/clients", { method: "POST", body: JSON.stringify({ name: data.get("name"), email: data.get("email") || null, phone: data.get("phone") || null }) });
      if (kind === "project") await requestJson("/api/projects", { method: "POST", body: JSON.stringify({ name: data.get("name"), code: data.get("code"), kind: data.get("projectKind"), clientId: data.get("clientId") === "none" ? null : data.get("clientId"), phase: "briefing", budgetCents: 0 }) });
      if (kind === "task") await requestJson("/api/tasks", { method: "POST", body: JSON.stringify({ title: data.get("title"), projectId: data.get("projectId"), priority: data.get("priority"), estimatedMinutes: 0 }) });
      toast.success(kind === "client" ? "Cliente criado" : kind === "project" ? "Projeto criado" : "Tarefa criada");
      onOpenChange(false); await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Novo registro</DialogTitle><DialogDescription>Salve apenas informações reais da empresa atual.</DialogDescription></DialogHeader><div className="grid grid-cols-3 gap-2">{(["client", "project", "task"] as CreateKind[]).map((item) => <Button key={item} type="button" variant={kind === item ? "default" : "outline"} onClick={() => setKind(item)}>{item === "client" ? "Cliente" : item === "project" ? "Projeto" : "Tarefa"}</Button>)}</div><form onSubmit={submit} className="space-y-4">{kind === "client" ? <><Field name="name" label="Nome do cliente" required /><Field name="email" label="E-mail" type="email" /><Field name="phone" label="Telefone" /></> : null}{kind === "project" ? <><div className="grid gap-4 sm:grid-cols-2"><Field name="code" label="Código" placeholder="ARQ-001" required /><Field name="name" label="Nome do projeto" required /></div><NativeChoice name="projectKind" label="Tipo" defaultValue="project" options={[{ value: "project", label: "Projeto" }, { value: "work", label: "Obra" }]} /><NativeChoice name="clientId" label="Cliente" defaultValue="none" options={[{ value: "none", label: "Sem cliente" }, ...clients.map((client) => ({ value: client.id, label: client.name }))]} /></> : null}{kind === "task" ? <><Field name="title" label="Título da tarefa" required /><NativeChoice name="projectId" label="Projeto" required defaultValue={projects[0]?.id} options={projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))} /><NativeChoice name="priority" label="Prioridade" defaultValue="normal" options={[{ value: "low", label: "Baixa" }, { value: "normal", label: "Normal" }, { value: "high", label: "Alta" }, { value: "critical", label: "Crítica" }]} /></> : null}{error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}<Button type="submit" className="w-full" disabled={saving || (kind === "task" && projects.length === 0)}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar</Button></form></DialogContent></Dialog>;
}

function Field({ name, label, type = "text", placeholder, required }: { name: string; label: string; type?: string; placeholder?: string; required?: boolean }) {
  return <div><label htmlFor={name} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label><Input id={name} name={name} type={type} placeholder={placeholder} required={required} /></div>;
}
function NativeChoice({ name, label, options, defaultValue, required }: { name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string; required?: boolean }) {
  return <div><label htmlFor={name} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label><select id={name} name={name} defaultValue={defaultValue} required={required} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

function Workspace({ session, reloadSession }: { session: SessionData; reloadSession: () => Promise<void> }) {
  const [activeModule, setActiveModule] = useState<ModuleId>("overview");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [financial, setFinancial] = useState<FinancialSummary | null>(null);
  const [financialMessage, setFinancialMessage] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickKind, setQuickKind] = useState<CreateKind>("project");
  const [companyOpen, setCompanyOpen] = useState(false);

  const loadData = useCallback(async () => {
    await Promise.resolve();
    setLoading(true); setError(""); setFinancialMessage("");
    try {
      const [clientData, projectData, taskData, memberData] = await Promise.all([
        requestJson<{ clients: Client[] }>("/api/clients"), requestJson<{ projects: Project[] }>("/api/projects"),
        requestJson<{ tasks: Task[] }>("/api/tasks"), requestJson<{ members: Member[] }>("/api/members"),
      ]);
      setClients(clientData.clients); setProjects(projectData.projects); setTasks(taskData.tasks); setMembers(memberData.members);
      try { const financeData = await requestJson<FinancialSummary>("/api/integrations/drap/summary"); setFinancial(financeData); }
      catch (cause) { setFinancial(null); setFinancialMessage(cause instanceof Error ? cause.message : "Financeiro indisponível."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os dados."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData, session.organization?.id]);

  async function switchOrganization(organizationId: string) {
    try { await requestJson("/api/session", { method: "POST", body: JSON.stringify({ organizationId }) }); await reloadSession(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível trocar de empresa."); }
  }
  function openCreate(kind: CreateKind) { setQuickKind(kind); setQuickOpen(true); }
  async function completeTask(task: Task) {
    try { await requestJson(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }); toast.success("Tarefa concluída"); await loadData(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível concluir a tarefa."); }
  }

  const overdue = tasks.filter((task) => task.status !== "done" && task.dueAt && new Date(task.dueAt) < new Date());
  const activeProjects = projects.filter((project) => project.status === "active");
  const navSections: { label: string; items: { id: ModuleId; label: string; icon: LucideIcon; badge?: number }[] }[] = [
    { label: "Trabalho", items: [{ id: "overview", label: "Visão geral", icon: LayoutDashboard }, { id: "projects", label: "Projetos", icon: FolderKanban, badge: projects.filter((p) => p.kind === "project").length }, { id: "works", label: "Obras", icon: Building2, badge: projects.filter((p) => p.kind === "work").length }, { id: "budgets", label: "Orçamentos", icon: Calculator }, { id: "schedule", label: "Cronograma", icon: CalendarRange }] },
    { label: "Negócio", items: [{ id: "crm", label: "Clientes", icon: Target, badge: clients.length }, { id: "finance", label: "Financeiro", icon: WalletCards }, { id: "team", label: "Equipe", icon: Users, badge: members.length }] },
    { label: "Organização", items: [{ id: "tasks", label: "Tarefas", icon: ListChecks, badge: tasks.filter((t) => t.status !== "done").length }, { id: "files", label: "Arquivos", icon: Files }] },
  ];

  const content = loading ? <Card><Empty className="min-h-72 border-0"><LoaderCircle className="size-7 animate-spin text-blue-600" /><p className="text-sm text-slate-500">Carregando dados da empresa…</p></Empty></Card> : error ? <HonestEmpty icon={CircleAlert} title="Não foi possível carregar" description={error} action={loadData} actionLabel="Tentar novamente" /> : (() => {
    if (activeModule === "overview") return <div className="space-y-5"><PageIntro module="overview" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi icon={FolderKanban} label="Trabalhos ativos" value={String(activeProjects.length)} detail={`${projects.length} cadastrados`} /><Kpi icon={ListChecks} label="Tarefas abertas" value={String(tasks.filter((t) => t.status !== "done").length)} detail={`${overdue.length} vencidas`} tone={overdue.length ? "amber" : "blue"} /><Kpi icon={Target} label="Clientes" value={String(clients.length)} detail="na empresa atual" /><Kpi icon={Users} label="Equipe" value={String(members.length)} detail="membros ativos" tone="emerald" /></div>{tasks.length ? <Card><CardHeader><CardTitle className="text-base">Próximas tarefas</CardTitle></CardHeader><CardContent className="space-y-2">{tasks.filter((task) => task.status !== "done").slice(0, 6).map((task) => <div key={task.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><button onClick={() => void completeTask(task)} aria-label={`Concluir ${task.title}`} className="grid size-6 place-items-center rounded-full border border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-600"><Check className="size-3.5" /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p><p className="text-xs text-slate-500">{task.projectName}</p></div><StatusBadge status={task.status} /></div>)}</CardContent></Card> : <HonestEmpty icon={ListChecks} title="Sua operação começa aqui" description="Cadastre um cliente e um projeto; depois organize as primeiras tarefas." action={() => openCreate("client")} actionLabel="Cadastrar cliente" />}</div>;
    if (activeModule === "projects" || activeModule === "works") { const filtered = projects.filter((project) => activeModule === "works" ? project.kind === "work" : project.kind === "project"); return <div className="space-y-5"><PageIntro module={activeModule} action={() => openCreate("project")} actionLabel={activeModule === "works" ? "Nova obra" : "Novo projeto"} />{filtered.length ? <ProjectTable projects={filtered} query={query} /> : <HonestEmpty icon={activeModule === "works" ? Building2 : FolderKanban} title={activeModule === "works" ? "Nenhuma obra cadastrada" : "Nenhum projeto cadastrado"} description="Cadastre o primeiro trabalho real desta empresa." action={() => openCreate("project")} actionLabel={activeModule === "works" ? "Cadastrar obra" : "Cadastrar projeto"} />}</div>; }
    if (activeModule === "crm") return <div className="space-y-5"><PageIntro module="crm" action={() => openCreate("client")} actionLabel="Novo cliente" />{clients.length ? <Card className="overflow-hidden"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="pl-5">Cliente</TableHead><TableHead>Contato</TableHead><TableHead>Documento</TableHead></TableRow></TableHeader><TableBody>{clients.map((client) => <TableRow key={client.id}><TableCell className="pl-5 font-medium">{client.name}</TableCell><TableCell><p>{client.email ?? "Sem e-mail"}</p><p className="text-xs text-slate-500">{client.phone ?? "Sem telefone"}</p></TableCell><TableCell>{client.document ?? "Não informado"}</TableCell></TableRow>)}</TableBody></Table></Card> : <HonestEmpty icon={Target} title="Nenhum cliente cadastrado" description="Adicione o primeiro cliente real para iniciar o fluxo comercial." action={() => openCreate("client")} actionLabel="Cadastrar cliente" />}</div>;
    if (activeModule === "tasks") return <div className="space-y-5"><PageIntro module="tasks" action={() => openCreate("task")} actionLabel="Nova tarefa" />{tasks.length ? <Card><CardContent className="divide-y p-0">{tasks.map((task) => <div key={task.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><button disabled={task.status === "done"} onClick={() => void completeTask(task)} aria-label={`Concluir ${task.title}`} className="grid size-6 shrink-0 place-items-center rounded-full border border-slate-300 text-transparent enabled:hover:border-emerald-500 enabled:hover:text-emerald-600 disabled:bg-emerald-50 disabled:text-emerald-600"><Check className="size-3.5" /></button><div className="min-w-0 flex-1"><p className="font-medium">{task.title}</p><p className="text-xs text-slate-500">{task.projectName}{task.assigneeName ? ` · ${task.assigneeName}` : ""}</p></div><StatusBadge status={task.status} /></div>)}</CardContent></Card> : <HonestEmpty icon={ListChecks} title="Nenhuma tarefa cadastrada" description={projects.length ? "Crie a primeira tarefa ligada a um projeto." : "Cadastre um projeto antes de criar tarefas."} action={projects.length ? () => openCreate("task") : () => openCreate("project")} actionLabel={projects.length ? "Criar tarefa" : "Cadastrar projeto"} />}</div>;
    if (activeModule === "team") return <div className="space-y-5"><PageIntro module="team" />{members.length ? <div className="grid gap-3 md:grid-cols-2">{members.map((member) => <Card key={member.id} className="p-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-cyan-500 font-semibold text-slate-950">{member.name.slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate font-medium">{member.name}</p><p className="truncate text-xs text-slate-500">{member.email}</p></div><Badge variant="outline">{roleLabels[member.role] ?? member.role}</Badge></div></Card>)}</div> : <HonestEmpty icon={Users} title="Nenhum membro ativo" description="Convites e gestão de equipe serão a próxima evolução da conta." />}</div>;
    if (activeModule === "finance") return <div className="space-y-5"><PageIntro module="finance" />{financial ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi icon={CircleDollarSign} label="Saldo atual" value={currency.format(financial.currentBalance)} detail={`Atualizado em ${new Date(financial.updatedAt).toLocaleString("pt-BR")}`} tone="emerald" /><Kpi icon={WalletCards} label="A receber" value={compactCurrency.format(financial.receivables)} detail={`${currency.format(financial.overdueReceivables)} vencidos`} /><Kpi icon={CircleAlert} label="A pagar" value={compactCurrency.format(financial.payables)} detail="fonte oficial Drap" tone="amber" /><Kpi icon={Clock3} label="Projetado em 30 dias" value={compactCurrency.format(financial.projected30d)} detail="fonte oficial Drap" /></div> : <HonestEmpty icon={Database} title="Financeiro ainda não conectado" description={financialMessage || "Conecte a conta Drap desta empresa para exibir valores oficiais."} />}</div>;
    const future = activeModule === "budgets" ? { icon: Calculator, title: "Orçamentos ainda não conectados", description: "A próxima etapa ligará composições e versões reais ao projeto." } : activeModule === "schedule" ? { icon: CalendarRange, title: "Cronograma ainda não conectado", description: "Os prazos serão montados com projetos e tarefas reais." } : { icon: Files, title: "Arquivos ainda não conectados", description: "Os documentos serão armazenados por empresa e projeto no R2." };
    return <div className="space-y-5"><PageIntro module={activeModule} /><HonestEmpty {...future} /></div>;
  })();

  return <SidebarProvider className="nexo-shell" style={{ "--sidebar-width": "17rem" } as React.CSSProperties}><Sidebar collapsible="icon" className="nexo-sidebar border-r-0"><SidebarHeader className="p-3.5"><div className="group-data-[collapsible=icon]:hidden"><Brand dark /></div><div className="hidden group-data-[collapsible=icon]:block"><Brand compact /></div><div className="mt-2 group-data-[collapsible=icon]:hidden"><Select value={session.organization?.id} onValueChange={(value) => void switchOrganization(value)}><SelectTrigger className="h-10 w-full border-white/10 bg-white/5 text-left text-white"><SelectValue /></SelectTrigger><SelectContent>{session.organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}</SelectContent></Select></div></SidebarHeader><SidebarSeparator /><SidebarContent className="px-1 py-2">{navSections.map((section) => <SidebarGroup key={section.label}><SidebarGroupLabel className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{section.label}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{section.items.map((item) => <SidebarMenuItem key={item.id}><SidebarMenuButton tooltip={item.label} isActive={activeModule === item.id} onClick={() => setActiveModule(item.id)} className="h-10 rounded-lg text-slate-300 data-[active=true]:bg-cyan-500 data-[active=true]:text-slate-950 hover:bg-white/[0.07] hover:text-white"><item.icon /><span>{item.label}</span></SidebarMenuButton>{item.badge ? <SidebarMenuBadge className={activeModule === item.id ? "text-slate-950" : "text-slate-400"}>{item.badge}</SidebarMenuBadge> : null}</SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>)}</SidebarContent><SidebarSeparator /><SidebarFooter className="p-3"><SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={() => setCompanyOpen(true)} tooltip="Nova empresa" className="text-slate-300 hover:text-white"><Building2 /><span>Nova empresa</span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton size="lg" tooltip="Conta" className="text-slate-300 hover:text-white"><span className="grid size-9 place-items-center rounded-full bg-cyan-500 text-xs font-semibold text-slate-950">{session.user?.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-white">{session.user?.displayName}</span><span className="block truncate text-xs text-slate-400">{roleLabels[session.member?.role ?? ""] ?? session.member?.role}</span></span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton asChild tooltip="Sair" className="text-slate-400 hover:text-white"><a href="/signout-with-chatgpt?return_to=%2F" target="_top"><LogOut /><span>Sair</span></a></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter><SidebarRail /></Sidebar><SidebarInset><header className="nexo-header sticky top-0 z-20 flex h-[4.5rem] items-center gap-3 border-b border-white/80 px-4 backdrop-blur-xl sm:px-6"><SidebarTrigger className="size-10 rounded-xl border border-slate-200 bg-white" /><p className="hidden text-sm font-semibold text-slate-700 sm:block">{moduleTitles[activeModule].title}</p><div className="mx-auto w-full max-w-md sm:ml-auto sm:mr-0"><div className="relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nesta empresa…" className="h-10 rounded-xl bg-white pl-10" /></div></div><Button variant="ghost" size="icon" aria-label="Notificações"><Bell /></Button><Button size="sm" onClick={() => openCreate("project")} className="rounded-xl"><Plus /><span className="hidden sm:inline">Criar</span></Button></header><main className="nexo-canvas blueprint-grid min-h-[calc(100svh-4.5rem)] p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1480px]">{content}</div></main></SidebarInset><QuickCreate key={`${quickKind}-${quickOpen}`} open={quickOpen} onOpenChange={setQuickOpen} projects={projects} clients={clients} initialKind={quickKind} onCreated={loadData} /><Dialog open={companyOpen} onOpenChange={setCompanyOpen}><DialogContent><DialogHeader><DialogTitle>Nova empresa</DialogTitle><DialogDescription>Crie outro ambiente totalmente separado dos dados atuais.</DialogDescription></DialogHeader><OrganizationForm embedded onCreated={async () => { setCompanyOpen(false); await reloadSession(); }} /></DialogContent></Dialog><Toaster position="bottom-right" /></SidebarProvider>;
}

export function NexoApp() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const loadSession = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    try { setSession(await requestJson<SessionData>("/api/session")); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível abrir sua conta."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSession(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSession]);
  const ready = useMemo(() => session?.authenticated && !session.needsOrganization && session.organization, [session]);
  if (loading || !session) return <LoadingScreen />;
  if (!session.authenticated) return <AccessScreen signInPath={session.signInPath} />;
  if (session.needsOrganization) return <OrganizationForm onCreated={loadSession} />;
  if (!ready) return <LoadingScreen />;
  return <Workspace session={session} reloadSession={loadSession} />;
}
