"use client";

import { BrandLogo, type BrandVariant } from "@/components/brand-logo";
import { TeamWorkload } from "@/components/team-workload";
import { TasksWorkspace } from "@/components/tasks-workspace";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useLatestRequest } from "@/hooks/use-latest-request";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  BellRing,
  DraftingCompass,
  PencilRuler,
  MessagesSquare,
  Sofa,
  BookOpenText,
  Building2,
  Calculator,
  CalendarRange,
  Check,
  CircleAlert,
  Clock,
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
  Sigma,
  Target,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { BudgetsWorkspace } from "@/components/budgets-workspace";
import { FinanceWorkspace } from "@/components/finance-workspace";
import { DiaryWorkspace } from "@/components/diary-workspace";
import { UsageWorkspace, useUsageHeartbeat } from "@/components/usage-workspace";
import { WorksheetsWorkspace } from "@/components/worksheets-workspace";
import { ReminderBell, RemindersWorkspace, useReminders } from "@/components/reminders-workspace";
import { PortalManager } from "@/components/portal-manager";
import { ClientPortalApp } from "@/components/client-portal-app";
import { CrmWorkspace } from "@/components/crm-workspace";
import { ScheduleWorkspace } from "@/components/schedule-workspace";
import { FilesWorkspace } from "@/components/files-workspace";
import { PranchetaWorkspace } from "@/components/prancheta/prancheta-workspace";
import { PranchetaWorkspace as EditorCadWorkspace } from "@/components/prancheta-workspace";
import { ComunicacaoWorkspace } from "@/components/comunicacao/comunicacao-workspace";
import { LayoutWorkspace } from "@/components/layout/layout-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TeamAccessManager, type TeamMember } from "@/components/team-access-manager";
import { accessProfileLabels, podeAdministrarEmpresa, type PermissionModule, type PermissionSet } from "@/lib/permissions";
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

type ModuleId = "overview" | "projects" | "works" | "budgets" | "schedule" | "diary" | "portal" | "crm" | "finance" | "team" | "tasks" | "files" | "usage" | "sheets" | "reminders" | "prancheta" | "studio" | "comunicacao" | "layout";
type CreateKind = "client" | "project" | "task";

type Organization = { id: string; name: string; slug: string; timezone: string; role?: string };
type SessionData = {
  authenticated: boolean;
  authMethod?: "password" | "maintenance" | "superadmin";
  needsOrganization: boolean;
  organizationSelectionRequired?: boolean;
  portalOnly?: boolean;
  platformEmpty?: boolean;
  maintenanceEnvironment?: boolean;
  user?: { id: string; email: string; displayName: string };
  member?: { id: string; role: string; permissions: PermissionSet };
  terms?: { version: string; accepted: boolean };
  organization?: Organization;
  organizations: Organization[];
};
type Client = { id: string; name: string; email: string | null; phone: string | null; document: string | null; updatedAt: string };
type Project = {
  id: string; clientId: string | null; clientName: string | null; code: string; name: string;
  kind: "project" | "work"; status: string; phase: string; progressPercent: number;
  ownerName: string | null; targetDate: string | null; budgetCents: number | null;
  externalFinancialCostCenterId?: string | null;
};
type Task = {
  id: string; projectId: string; projectName: string; title: string; status: string;
  description?: string; assigneeMemberId?: string | null; priority: string; assigneeName: string | null; dueAt: string | null;
  parentTaskId: string | null; startsAt: string | null; estimatedMinutes: number;
};
type Member = TeamMember;
class RequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string; falha?: string };
  if (!response.ok) throw new RequestError(body.error ? (body.falha ? `${body.error} (${body.falha})` : body.error) : "Não foi possível concluir a operação.", body.code);
  return body as T;
}

const moduleTitles: Record<ModuleId, { title: string; description: string }> = {
  overview: { title: "Visão geral", description: "Prioridades e andamento da empresa atual." },
  projects: { title: "Projetos", description: "Projetos reais, clientes, etapas e responsáveis." },
  works: { title: "Obras", description: "Obras em execução e seus avanços." },
  budgets: { title: "Orçamentos", description: "Custos, BDI, margem e aprovação." },
  schedule: { title: "Cronograma", description: "Prazos ligados a projetos e tarefas." },
  diary: { title: "Diário de obra", description: "Atividades, ocorrências, fotos e histórico." },
  portal: { title: "Portal do cliente", description: "Andamento compartilhado e decisões registradas." },
  crm: { title: "CRM e clientes", description: "Funil, clientes, próximos passos e conversão em trabalhos." },
  finance: { title: "Financeiro", description: "Informações oficiais vindas da Drap." },
  team: { title: "Equipe", description: "Pessoas com acesso a esta empresa." },
  tasks: { title: "Tarefas", description: "Execução organizada por prioridade e projeto." },
  files: { title: "Arquivos", description: "Documentos vinculados aos trabalhos." },
  usage: { title: "Tempo de uso", description: "Tempo online por dia, medido no servidor." },
  sheets: { title: "Planilha e documento", description: "Cálculo sobre os dados reais da empresa." },
  reminders: { title: "Lembretes do dia", description: "Cobranças, boletos, follow-ups, prazos e metas." },
  prancheta: { title: "Prancheta", description: "Abrir, converter e compartilhar arquivos de projeto." },
  studio: { title: "Editor CAD", description: "Desenho técnico em camadas: planta, elétrico, luminotécnico e interiores. Importa DWG e DXF com todas as camadas." },
  comunicacao: { title: "Comunicação", description: "Mensagens, arquivos e lembretes da equipe." },
  layout: { title: "Criador de layout", description: "Planta com móveis e veículos e prévia 3D para a proposta." },
};

const modulePermissionMap: Record<ModuleId, PermissionModule> = {
  overview: "overview", projects: "projects", works: "projects", budgets: "budgets",
  schedule: "schedule", diary: "diary", portal: "portal", crm: "crm", finance: "finance", team: "team", tasks: "tasks", files: "files",
  usage: "overview", sheets: "overview", reminders: "overview", prancheta: "studio", studio: "studio", comunicacao: "overview", layout: "studio",
};
// Conversar com a própria equipe não depende de módulo: toda pessoa da empresa usa.
const alwaysVisibleModules: ModuleId[] = ["usage", "sheets", "reminders", "comunicacao"];

const roleLabels: Record<string, string> = { ...accessProfileLabels, client: "Cliente" };
function Brand({ variant = "lockup", dark = false, className }: { variant?: BrandVariant; dark?: boolean; className?: string }) {
  return <BrandLogo variant={variant} dark={dark} className={className} />;
}

function PlatformEmptyScreen() {
  return <main className="grid min-h-svh place-items-center bg-primary p-5"><Card className="w-full max-w-md border-white/10 bg-primary text-white shadow-none"><CardContent className="p-7 sm:p-9"><Brand variant="stacked" dark className="mx-auto w-[200px]" /><h1 className="display-heading mt-8 text-3xl">Nenhuma empresa cadastrada</h1><p className="mt-3 text-sm leading-6 text-hoikos-300">Cadastre a primeira empresa no painel da plataforma e libere o acesso do contratante.</p><Button asChild className="mt-6 h-11 w-full bg-hoikos-400 text-hoikos-950 hover:bg-hoikos-200"><a href="/superadmin"><ShieldCheck />Abrir painel da plataforma</a></Button></CardContent></Card></main>;
}

function LoadingScreen() {
  return <main className="grid min-h-svh place-items-center bg-hoikos-950"><div className="flex flex-col items-center gap-6"><Brand variant="stacked" dark className="w-[220px]" /><LoaderCircle className="size-5 animate-spin text-hoikos-300" /><p className="text-sm text-hoikos-500">Abrindo sua empresa…</p></div></main>;
}

type Saude = {
  pronto: boolean;
  banco: string; sessao: string; superadmin: string; armazenamento: string;
  migracoes?: { aplicadas: number; pendentes: number };
  // Descrição estrutural do que o servidor recebeu — nunca o valor do segredo.
  detalhes?: Partial<Record<"superadmin" | "armazenamento", string>>;
};

const DIAGNOSTICO: Record<string, Record<string, string>> = {
  banco: {
    nao_configurado: "Banco de dados não configurado nesta publicação. Defina a URL do banco (ou conecte a integração Turso) nas variáveis de ambiente.",
    inalcancavel: "O banco de dados não respondeu. A URL ou o token estão errados, vencidos, ou o servidor está fora.",
    falta_migrar: "O banco está conectado, mas sem as tabelas. Entre como superadministrador e use “Atualizar banco de dados”.",
  },
  sessao: {
    nao_configurado: "A assinatura de sessão não está configurada: defina SESSION_SECRET.",
    configuracao_invalida: "A assinatura de sessão é curta demais: SESSION_SECRET precisa de pelo menos 32 caracteres.",
  },
  superadmin: {
    nao_configurado: "O acesso administrativo não está configurado: faltam e-mail, hash da senha ou segredo de sessão.",
    configuracao_invalida: "O hash da senha administrativa não está no formato esperado.",
  },
  armazenamento: {
    nao_configurado: "Armazenamento de arquivos não configurado. Cadastros em texto continuam disponíveis; fotos e documentos ficam indisponíveis.",
    configuracao_invalida: "A chave de cifra dos arquivos é inválida: precisa de 32 bytes em base64.",
  },
};

function InstallationHealth() {
  const [saude, setSaude] = useState<Saude | null>(null);
  useEffect(() => {
    let ativo = true;
    fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).then((corpo: Saude) => { if (ativo) setSaude(corpo); }).catch(() => undefined);
    return () => { ativo = false; };
  }, []);
  if (!saude || saude.pronto) return null;
  const problemas = (["banco", "sessao", "superadmin", "armazenamento"] as const)
    .map((area) => {
      const texto = DIAGNOSTICO[area]?.[saude[area]];
      if (!texto) return null;
      // O detalhe é o que transforma "está inválido" em "confira isto": sem ele, a tela
      // já mandou gerar o hash com ":" para quem tinha acabado de gerar com ":".
      const detalhe = saude.detalhes?.[area as "superadmin" | "armazenamento"];
      // O detalhe já vem como frase fechada, com a pontuação dele.
      return detalhe ? `${texto} ${detalhe}` : texto;
    })
    .filter(Boolean);
  if (!problemas.length) return null;
  return <div role="status" className="mt-7 rounded-md border border-hoikos-400/25 bg-hoikos-400/10 p-4 text-sm leading-6 text-hoikos-100"><p className="flex items-center gap-2 font-medium"><CircleAlert className="size-4" />Instalação incompleta</p><ul className="mt-2 list-disc space-y-1 pl-5 text-hoikos-200">{problemas.map((texto) => <li key={texto}>{texto}</li>)}</ul><p className="mt-3 text-xs text-hoikos-300">Entrar não vai funcionar enquanto isso não for resolvido na configuração da publicação.</p></div>;
}

function AccessScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Um só formulário: o servidor reconhece pelas credenciais se é conta de empresa ou o
  // superadministrador da plataforma, e diz para onde seguir.
  async function submitAccount(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const result = await requestJson<{ redirectTo?: string }>("/api/auth/session", { method: "POST", body: JSON.stringify({ email, password }) });
      window.location.assign(result.redirectTo === "/superadmin" ? "/superadmin" : "/");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar."); setLoading(false); }
  }
  return <main className="relative grid min-h-svh place-items-center overflow-hidden bg-primary p-5"><Card className="relative w-full max-w-lg border-white/10 bg-primary text-white shadow-none"><CardContent className="p-7 sm:p-9"><Brand variant="stacked" dark className="mx-auto w-[210px]" /><h1 className="sr-only">Acesso à plataforma</h1><p className="mt-8 text-base leading-7 text-hoikos-300">Entre com o seu e-mail e a sua senha.</p><InstallationHealth /><form onSubmit={submitAccount} className="mt-6 space-y-4"><div><label htmlFor="account-email" className="mb-2 block text-sm font-medium text-hoikos-200">E-mail</label><Input id="account-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required className="h-11 border-white/10 bg-white/[0.06] text-white placeholder:text-hoikos-500" /></div><div><label htmlFor="account-password" className="mb-2 block text-sm font-medium text-hoikos-200">Senha</label><div className="relative"><Input id="account-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="h-11 border-white/10 bg-white/[0.06] pr-11 text-white placeholder:text-hoikos-500" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-hoikos-500 hover:text-white">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>{error ? <p role="alert" className="rounded-md border border-hoikos-400/20 bg-hoikos-400/10 px-3 py-2 text-sm text-hoikos-200">{error}</p> : null}<Button type="submit" disabled={loading} className="h-11 w-full rounded-md bg-hoikos-500 text-hoikos-950 hover:bg-hoikos-400">{loading ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Entrar</Button></form><p className="mt-3 text-center text-xs leading-5 text-hoikos-500">Sua senha é criada no link de convite enviado pela empresa.</p><a href="/portal" className="mt-4 block text-center text-sm text-hoikos-300 hover:text-hoikos-200">Sou cliente: acompanhar minha obra</a><p className="mt-6 flex items-center justify-center gap-2 text-xs text-hoikos-500"><ShieldCheck className="size-4" />Acesso protegido e dados separados por empresa.</p><div className="mt-3 flex items-center justify-center gap-4 text-xs"><a href="/termos" className="text-hoikos-300 hover:text-hoikos-200">Termos de Uso</a><a href="/manutencao" className="text-hoikos-300 hover:text-hoikos-200">Acesso de manutenção</a></div></CardContent></Card></main>;
}

function OrganizationForm({ onCreated, embedded = false }: { onCreated: () => Promise<void> | void; embedded?: boolean }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await requestJson("/api/onboarding", { method: "POST", body: JSON.stringify({ organizationName: name, acceptTerms: acceptedTerms }) }); toast.success("Empresa criada", { description: `${name} já está pronta para receber dados reais.` }); await onCreated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a empresa."); }
    finally { setSaving(false); }
  }
  const form = <form onSubmit={submit} className="space-y-5"><div><label htmlFor="organization-name" className="mb-2 block text-sm font-medium">Nome da empresa</label><Input id="organization-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Meu Escritório de Arquitetura" minLength={2} required className="h-11" /></div><label className="flex items-start gap-3 rounded-md border border-hoikos-200 bg-hoikos-50 p-4 text-sm leading-6"><Checkbox checked={acceptedTerms} onCheckedChange={(value) => setAcceptedTerms(value === true)} className="mt-1" /><span>Li e aceito os <a href="/termos" target="_blank" className="font-medium text-hoikos-700 underline underline-offset-2">Termos de Uso e Privacidade</a>.</span></label>{error ? <p role="alert" className="text-sm text-hoikos-600">{error}</p> : null}<Button type="submit" disabled={saving || name.trim().length < 2 || !acceptedTerms} className="h-11 w-full rounded-md bg-hoikos-500 text-hoikos-950 hover:bg-hoikos-400">{saving ? <LoaderCircle className="animate-spin" /> : <Building2 />}Criar empresa</Button></form>;
  if (embedded) return form;
  return <main className="grid min-h-svh place-items-center bg-hoikos-50 p-5"><Card className="w-full max-w-lg border-hoikos-200 shadow-none"><CardHeader><Brand variant="signature" className="w-[220px]" /><CardTitle className="pt-6 text-2xl">Crie sua primeira empresa</CardTitle><p className="text-sm leading-6 text-hoikos-500">A conta começa vazia. Você adiciona apenas os dados reais da sua operação.</p></CardHeader><CardContent>{form}</CardContent></Card></main>;
}

function Kpi({ icon: Icon, label, value, detail, attention = false }: { icon: LucideIcon; label: string; value: string; detail: string; attention?: boolean }) {
  return <div className="hoikos-metric" data-attention={attention || undefined}>
    <div className="hoikos-metric-label"><Icon aria-hidden="true" className="size-4" /><span>{label}</span></div>
    <p className="metric-number hoikos-metric-value">{value}</p>
    <p className="hoikos-metric-detail">{attention && <CircleAlert aria-hidden="true" className="size-3.5" />}{detail}</p>
  </div>;
}

function PageIntro({ module, action, actionLabel }: { module: ModuleId; action?: () => void; actionLabel?: string }) {
  const copy = moduleTitles[module];
  return <div className="hoikos-page-intro hoikos-module-heading flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow text-hoikos-600">Empresa atual</p><h1 className="display-heading mt-2 text-4xl text-hoikos-950">{copy.title}</h1><p className="mt-2 text-sm text-hoikos-500">{copy.description}</p></div>{action ? <Button onClick={action} className="rounded-md"><Plus />{actionLabel}</Button> : null}</div>;
}

function HonestEmpty({ icon: Icon, title, description, action, actionLabel }: { icon: LucideIcon; title: string; description: string; action?: () => void; actionLabel?: string }) {
  return <Card><Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon" className="bg-hoikos-50 text-hoikos-700"><Icon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action ? <EmptyContent><Button onClick={action}><Plus />{actionLabel}</Button></EmptyContent> : null}</Empty></Card>;
}

// Todos os estados tinham a mesma aparência, então uma lista de tarefas ou projetos não
// dizia nada de relance. O dourado — única cor de matiz diferente no guia da marca — fica
// para o que trava trabalho; o concluído recua para o acinzentado, porque já não pede
// ação; o que está em andamento é o marrom, que é onde o olho deve cair.
const APARENCIA_DO_ESTADO: Record<string, string> = {
  active: "border-hoikos-300 bg-hoikos-linen text-hoikos-800",
  in_progress: "border-hoikos-300 bg-hoikos-linen text-hoikos-800",
  blocked: "border-hoikos-gold/40 bg-hoikos-gold/10 text-hoikos-gold",
  on_hold: "border-hoikos-gold/40 bg-hoikos-gold/10 text-hoikos-gold",
  completed: "border-hoikos-200 bg-hoikos-50 text-hoikos-500",
  done: "border-hoikos-200 bg-hoikos-50 text-hoikos-500",
  archived: "border-hoikos-200 bg-hoikos-50 text-hoikos-500",
};

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { active: "Em andamento", on_hold: "Pausado", completed: "Concluído", archived: "Arquivado", todo: "A fazer", in_progress: "Em execução", blocked: "Bloqueada", done: "Concluída" };
  return <Badge variant="outline" className={APARENCIA_DO_ESTADO[status] ?? "border-hoikos-300 bg-hoikos-50 text-hoikos-700"}>{labels[status] ?? status}</Badge>;
}

function ProjectTable({ projects, query }: { projects: Project[]; query: string }) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const rows = projects.filter((project) => !normalized || `${project.name} ${project.clientName ?? ""} ${project.code}`.toLocaleLowerCase("pt-BR").includes(normalized));
  // A busca que não encontra nada mostrava uma tabela vazia, sem dizer por quê.
  if (!rows.length) return <Card className="p-8 text-center text-sm text-hoikos-500" role="status">Nenhum trabalho corresponde a “{query.trim()}”.</Card>;
  return <Card className="overflow-hidden"><Table><TableHeader><TableRow className="bg-hoikos-50"><TableHead className="pl-5">Trabalho</TableHead><TableHead>Etapa</TableHead><TableHead>Avanço</TableHead><TableHead>Prazo</TableHead><TableHead className="pr-5 text-right">Situação</TableHead></TableRow></TableHeader><TableBody>{rows.map((project) => <TableRow key={project.id} className="group"><TableCell className="pl-5"><Link href={`/projetos/${project.id}`} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-hoikos-500"><p className="font-medium text-hoikos-900 transition-colors group-hover:text-hoikos-700">{project.name}</p><p className="text-xs text-hoikos-500">{project.code} · {project.clientName ?? "Cliente não informado"}</p></Link></TableCell><TableCell>{project.phase}</TableCell><TableCell><div className="flex min-w-32 items-center gap-2"><Progress value={project.progressPercent} className="h-1.5" /><span className="text-xs tabular-nums">{project.progressPercent}%</span></div></TableCell><TableCell>{project.targetDate ? new Date(`${project.targetDate}T12:00:00`).toLocaleDateString("pt-BR") : "Sem prazo"}</TableCell><TableCell className="pr-5 text-right"><StatusBadge status={project.status} /></TableCell></TableRow>)}</TableBody></Table></Card>;
}

function QuickCreate({ open, onOpenChange, projects, clients, initialKind, allowedKinds = ["client", "project", "task"], onCreated, projectKind = "project" }: { open: boolean; onOpenChange: (open: boolean) => void; projects: Project[]; clients: Client[]; initialKind: CreateKind; allowedKinds?: CreateKind[]; onCreated: () => Promise<void>; projectKind?: "project" | "work" }) {
  const [kind, setKind] = useState<CreateKind>(initialKind);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); const data = new FormData(event.currentTarget);
    try {
      if (kind === "client") await requestJson("/api/clients", { method: "POST", body: JSON.stringify({ name: data.get("name"), email: data.get("email") || null, phone: data.get("phone") || null }) });
      if (kind === "project") await requestJson("/api/projects", { method: "POST", body: JSON.stringify({ name: data.get("name"), code: data.get("code"), kind: data.get("projectKind"), clientId: data.get("clientId") === "none" ? null : data.get("clientId"), phase: "briefing", budgetCents: 0 }) });
      if (kind === "task") await requestJson("/api/tasks", { method: "POST", body: JSON.stringify({ title: data.get("title"), projectId: data.get("projectId"), priority: data.get("priority"), estimatedMinutes: 0 }) });
      toast.success(kind === "client" ? "Cliente criado" : kind === "project" ? "Projeto criado" : "Tarefa criada"); onOpenChange(false); await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Novo registro</DialogTitle><DialogDescription>Salve apenas informações reais da empresa atual.</DialogDescription></DialogHeader><div className={`grid gap-2 ${allowedKinds.length === 1 ? "grid-cols-1" : allowedKinds.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>{allowedKinds.map((item) => <Button key={item} type="button" variant={kind === item ? "default" : "outline"} onClick={() => setKind(item)}>{item === "client" ? "Cliente" : item === "project" ? "Projeto" : "Tarefa"}</Button>)}</div><form onSubmit={submit} className="space-y-4">{kind === "client" ? <><Field name="name" label="Nome do cliente" required /><Field name="email" label="E-mail" type="email" /><Field name="phone" label="Telefone" /></> : null}{kind === "project" ? <><div className="grid gap-4 sm:grid-cols-2"><Field name="code" label="Código" placeholder="ARQ-001" required /><Field name="name" label="Nome do projeto" required /></div><NativeChoice name="projectKind" label="Tipo" defaultValue={projectKind} options={[{ value: "project", label: "Projeto" }, { value: "work", label: "Obra" }]} /><NativeChoice name="clientId" label="Cliente" defaultValue="none" options={[{ value: "none", label: "Sem cliente" }, ...clients.map((client) => ({ value: client.id, label: client.name }))]} /></> : null}{kind === "task" && projects.length === 0
      ? <div className="rounded-md border border-hoikos-200 bg-hoikos-50 p-4 text-sm leading-6 text-hoikos-700"><p>Toda tarefa pertence a um projeto, e ainda não existe nenhum cadastrado.</p><Button type="button" variant="outline" className="mt-3" onClick={() => setKind("project")}>Cadastrar projeto primeiro</Button></div>
      : null}
    {kind === "task" && projects.length > 0 ? <><Field name="title" label="Título da tarefa" required /><NativeChoice name="projectId" label="Projeto" required defaultValue={projects[0]?.id} options={projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))} /><NativeChoice name="priority" label="Prioridade" defaultValue="normal" options={[{ value: "low", label: "Baixa" }, { value: "normal", label: "Normal" }, { value: "high", label: "Alta" }, { value: "critical", label: "Crítica" }]} /></> : null}{error ? <p role="alert" className="text-sm text-hoikos-600">{error}</p> : null}{kind === "task" && projects.length === 0 ? null
      : <Button type="submit" className="w-full" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar</Button>}</form></DialogContent></Dialog>;
}
function Field({ name, label, type = "text", placeholder, required }: { name: string; label: string; type?: string; placeholder?: string; required?: boolean }) { return <div><label htmlFor={name} className="mb-1.5 block text-sm font-medium text-hoikos-700">{label}</label><Input id={name} name={name} type={type} placeholder={placeholder} required={required} /></div>; }
function NativeChoice({ name, label, options, defaultValue, required }: { name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string; required?: boolean }) { return <div><label htmlFor={name} className="mb-1.5 block text-sm font-medium text-hoikos-700">{label}</label><select id={name} name={name} defaultValue={defaultValue} required={required} className="h-9 w-full rounded-md border border-hoikos-200 bg-white px-3 text-sm outline-none focus:border-hoikos-500 focus:ring-2 focus:ring-hoikos-100">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }

function TermsGate({ version, onAccepted }: { version: string; onAccepted: () => Promise<void> }) {
  const [checked, setChecked] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function accept() { setSaving(true); setError(""); try { await requestJson("/api/terms/accept", { method: "POST", body: JSON.stringify({ accepted: true, version }) }); await onAccepted(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar o aceite."); } finally { setSaving(false); } }
  return <main className="relative grid min-h-svh place-items-center overflow-hidden bg-primary p-5"><Card className="relative w-full max-w-xl border-white/10 bg-primary text-white shadow-none"><CardContent className="p-7 sm:p-9"><Brand variant="stacked" dark className="mx-auto w-[200px]" /><ShieldCheck className="mt-9 size-11 text-hoikos-300" /><h1 className="display-heading mt-5 text-4xl">Proteção e transparência</h1><p className="mt-3 leading-7 text-hoikos-300">Antes de continuar, confirme os termos atuais. Eles explicam os níveis de acesso, a separação entre empresas e os limites do superadministrador.</p><label className="mt-7 flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.05] p-4 text-sm leading-6 text-hoikos-200"><Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} className="mt-1 border-hoikos-500" /><span>Li e aceito os <a href="/termos" target="_blank" className="font-medium text-hoikos-300 underline underline-offset-2">Termos de Uso e Privacidade</a> (versão {version}).</span></label>{error ? <p role="alert" className="mt-4 text-sm text-hoikos-300">{error}</p> : null}<Button onClick={() => void accept()} disabled={!checked || saving} className="mt-6 h-11 w-full bg-hoikos-400 text-hoikos-950 hover:bg-hoikos-200">{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Aceitar e continuar</Button></CardContent></Card></main>;
}

function Workspace({ session, reloadSession }: { session: SessionData; reloadSession: () => Promise<void> }) {
  const [activeModule, setActiveModule] = useState<ModuleId>("overview");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<"clients" | "projects" | "tasks" | "members", string>>>({});
  const startRequest = useLatestRequest();
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickKind, setQuickKind] = useState<CreateKind>("project");
  const [companyOpen, setCompanyOpen] = useState(false);
  const { agenda, error: remindersError, reload: reloadReminders, mark: markReminder, pending } = useReminders(true);
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Contador de mensagens não lidas no menu, atualizado a cada minuto com a aba visível.
  useEffect(() => {
    if (!session.organization?.id) return;
    let vivo = true;
    const atualizar = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/conversas", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
        .then((body: { unreadTotal?: number } | null) => { if (vivo && body) setUnreadMessages(Number(body.unreadTotal ?? 0)); }).catch(() => undefined);
    };
    const inicio = window.setTimeout(atualizar, 1500);
    const intervalo = window.setInterval(atualizar, 60_000);
    return () => { vivo = false; window.clearTimeout(inicio); window.clearInterval(intervalo); };
  }, [session.organization?.id]);
  const canView = useCallback((module: ModuleId) => alwaysVisibleModules.includes(module) || Boolean(session.member?.permissions[modulePermissionMap[module]].view), [session.member]);
  const canEdit = useCallback((module: ModuleId) => Boolean(session.member?.permissions[modulePermissionMap[module]].edit), [session.member]);

  useEffect(() => { const timer = window.setTimeout(() => { const requested = new URLSearchParams(window.location.search).get("module"); if (requested && Object.hasOwn(modulePermissionMap, requested)) { const requestedModule = requested as ModuleId; if (canView(requestedModule)) setActiveModule(requestedModule); } }, 0); return () => window.clearTimeout(timer); }, [canView]);

  const loadData = useCallback(async () => {
    const isLatest = startRequest();
    await Promise.resolve(); setLoading(true);
      const [clientData, projectData, taskData, memberData] = await Promise.allSettled([
        canView("crm") ? requestJson<{ clients: Client[] }>("/api/clients") : Promise.resolve({ clients: [] }),
        canView("projects") ? requestJson<{ projects: Project[] }>("/api/projects") : Promise.resolve({ projects: [] }),
        canView("tasks") || canView("schedule") ? requestJson<{ tasks: Task[] }>(canView("tasks") ? "/api/tasks" : "/api/schedule") : Promise.resolve({ tasks: [] }),
        canView("team") ? requestJson<{ members: Member[] }>("/api/members") : Promise.resolve({ members: [] }),
      ]);
      if (!isLatest()) return;
      setClients(clientData.status === "fulfilled" ? clientData.value.clients : []);
      setProjects(projectData.status === "fulfilled" ? projectData.value.projects : []);
      setTasks(taskData.status === "fulfilled" ? taskData.value.tasks : []);
      setMembers(memberData.status === "fulfilled" ? memberData.value.members : []);
      const errors: Partial<Record<"clients" | "projects" | "tasks" | "members", string>> = {};
      for (const [key, result] of [["clients", clientData], ["projects", projectData], ["tasks", taskData], ["members", memberData]] as const) {
        if (result.status === "rejected") errors[key] = result.reason instanceof Error ? result.reason.message : "Não foi possível carregar os dados.";
      }
      setLoadErrors(errors); setLoading(false);
  }, [canView, startRequest]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadData(); }, 0); return () => window.clearTimeout(timer); }, [loadData, session.organization?.id]);
  useEffect(() => { if (!canView(activeModule)) { const first = (["overview", "projects", "works", "budgets", "schedule", "diary", "portal", "crm", "finance", "team", "tasks", "files", "prancheta", "studio", "layout", "comunicacao", "usage", "sheets", "reminders"] as ModuleId[]).find(canView); const timer = window.setTimeout(() => { if (first) setActiveModule(first); }, 0); return () => window.clearTimeout(timer); } }, [activeModule, canView]);

  async function switchOrganization(organizationId: string) { try { await requestJson("/api/session", { method: "POST", body: JSON.stringify({ organizationId }) }); await reloadSession(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível trocar de empresa."); } }
  // "Nova obra" abre o formulário já como obra: antes vinha como projeto e a obra criada
  // aparecia em Projetos, com a tela de Obras continuando vazia.
  const [quickProjectKind, setQuickProjectKind] = useState<"project" | "work">("project");
  function openCreate(kind: CreateKind, projectKind: "project" | "work" = "project") { setQuickKind(kind); setQuickProjectKind(projectKind); setQuickOpen(true); }
  const completeTask = useCallback(async (task: Task) => { if (!canEdit("tasks")) return; try { await requestJson(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }); toast.success("Tarefa concluída"); await loadData(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível concluir a tarefa."); } }, [canEdit, loadData]);
  async function logoutMaintenance() { await requestJson("/api/maintenance/session", { method: "DELETE" }).catch(() => undefined); window.location.assign("/manutencao"); }
  async function logoutAccount() { await requestJson("/api/auth/session", { method: "DELETE" }).catch(() => undefined); window.location.assign("/"); }

  const overdue = tasks.filter((task) => task.status !== "done" && task.dueAt && new Date(task.dueAt) < new Date());
  const activeProjects = projects.filter((project) => project.status === "active");
  const canCreateAny = canEdit("projects") || canEdit("crm") || canEdit("tasks");
  const navSections = ([
    { label: "Trabalho", items: [{ id: "overview", label: "Visão geral", icon: LayoutDashboard }, { id: "reminders", label: "Lembretes do dia", icon: BellRing, badge: pending || undefined }, { id: "projects", label: "Projetos", icon: FolderKanban, badge: projects.filter((p) => p.kind === "project").length }, { id: "works", label: "Obras", icon: Building2, badge: projects.filter((p) => p.kind === "work").length }, { id: "budgets", label: "Orçamentos", icon: Calculator }, { id: "schedule", label: "Cronograma", icon: CalendarRange }, { id: "prancheta", label: "Prancheta", icon: DraftingCompass }, { id: "studio", label: "Editor CAD", icon: PencilRuler }, { id: "layout", label: "Criador de layout", icon: Sofa }, { id: "comunicacao", label: "Comunicação", icon: MessagesSquare, badge: unreadMessages || undefined }] },
    { label: "Negócio", items: [{ id: "crm", label: "CRM e clientes", icon: Target, badge: clients.length }, { id: "portal", label: "Portal do cliente", icon: ShieldCheck }, { id: "finance", label: "Financeiro", icon: WalletCards }, { id: "team", label: "Equipe", icon: Users, badge: members.length }] },
    { label: "Organização", items: [{ id: "diary", label: "Diário de obra", icon: BookOpenText }, { id: "tasks", label: "Tarefas", icon: ListChecks, badge: tasks.filter((t) => t.status !== "done").length }, { id: "files", label: "Arquivos", icon: Files }, { id: "sheets", label: "Planilha e documento", icon: Sigma }, { id: "usage", label: "Tempo de uso", icon: Clock }] },
  ] satisfies { label: string; items: { id: ModuleId; label: string; icon: LucideIcon; badge?: number }[] }[]).map((section) => ({ ...section, items: section.items.filter((item) => canView(item.id)) })).filter((section) => section.items.length);

  const dependencies: Partial<Record<ModuleId, (keyof typeof loadErrors)[]>> = {
    overview: ["clients", "projects", "tasks", "members"], projects: ["projects"], works: ["projects"],
    crm: ["clients"], tasks: ["tasks"], schedule: ["tasks"], team: ["members", "tasks"],
    files: ["projects"], prancheta: ["projects"], studio: ["projects"], layout: ["projects"], finance: ["projects"], budgets: ["projects"],
  };
  const error = (dependencies[activeModule] ?? []).map(key => loadErrors[key]).filter(Boolean).join(" ");
  const content = loading ? <Card><Empty className="min-h-72 border-0"><LoaderCircle className="size-7 animate-spin text-hoikos-600" /><p className="text-sm text-hoikos-500">Carregando dados da empresa…</p></Empty></Card> : error ? <HonestEmpty icon={CircleAlert} title="Não foi possível carregar" description={error} action={loadData} actionLabel="Tentar novamente" /> : (() => {
    if (activeModule === "overview") {
      const openTasks = tasks.filter((task) => task.status !== "done")
        .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity));
      const steps = [
        { number: "01", title: "Cadastre seu cliente", description: "Centralize contatos e oportunidades.", icon: Target, done: clients.length > 0, visible: canView("crm"), editable: canEdit("crm"), kind: "client" as CreateKind, module: "crm" as ModuleId },
        { number: "02", title: "Abra um projeto", description: "Defina escopo, etapas e responsáveis.", icon: FolderKanban, done: projects.length > 0, visible: canView("projects"), editable: canEdit("projects"), kind: "project" as CreateKind, module: "projects" as ModuleId },
        { number: "03", title: "Organize as tarefas", description: "Transforme o planejamento em execução.", icon: ListChecks, done: tasks.length > 0, visible: canView("tasks"), editable: canEdit("tasks") && projects.length > 0, kind: "task" as CreateKind, module: "tasks" as ModuleId },
      ].filter((step) => step.visible);
      return <div className="hoikos-overview">
        <section className="hoikos-overview-heading">
          <div><p className="eyebrow">Seu escritório, em perspectiva</p><h1 className="display-heading">Visão geral</h1><p>Prioridades e andamento da empresa atual.</p></div>
          <span className="hoikos-company-context"><Building2 aria-hidden="true" className="size-4" />{session.organization?.name}</span>
        </section>
        <section className="hoikos-focus" aria-labelledby="hoikos-focus-title">
          <div className="hoikos-focus-copy"><p className="eyebrow">O que move o trabalho hoje</p><h2 id="hoikos-focus-title" className="display-heading">{overdue.length ? "Prazos que precisam de atenção." : activeProjects.length ? "Cada projeto, um próximo passo." : "Espaço para o seu próximo projeto."}</h2><p>{overdue.length ? `${overdue.length} tarefa(s) vencida(s). Revise os prazos e organize as próximas entregas.` : activeProjects.length ? `${activeProjects.length} trabalho(s) em andamento. Acompanhe as entregas e mantenha a equipe alinhada.` : "Reúna clientes, projetos e entregas em um só lugar. Comece pelo primeiro cadastro."}</p></div>
          <div className="hoikos-focus-action">{overdue.length && canView("tasks") ? <Button onClick={() => setActiveModule("tasks")}>Revisar tarefas<ArrowUpRight /></Button> : canEdit("projects") ? <Button onClick={() => openCreate("project")}>Novo projeto<Plus /></Button> : <Button onClick={() => setActiveModule("reminders")}>Ver lembretes<ArrowUpRight /></Button>}<span>H.OIKOS · Ecossistema para arquitetos</span></div>
        </section>
        <section className="hoikos-metrics" aria-label="Indicadores da empresa">
          {canView("projects") && <Kpi icon={FolderKanban} label="Trabalhos ativos" value={String(activeProjects.length)} detail={`${projects.length} cadastrados`} />}
          {(canView("tasks") || canView("schedule")) && <Kpi icon={ListChecks} label="Tarefas abertas" value={String(openTasks.length)} detail={`${overdue.length} vencidas`} attention={overdue.length > 0} />}
          {canView("crm") && <Kpi icon={Target} label="Clientes" value={String(clients.length)} detail="na empresa atual" />}
          {canView("team") && <Kpi icon={Users} label="Equipe" value={String(members.length)} detail="membros ativos" />}
        </section>
        {!projects.length && steps.length > 0 && <section className="hoikos-start" aria-labelledby="hoikos-start-title">
          <div className="hoikos-section-heading"><div><p className="eyebrow">Primeiros passos</p><h2 id="hoikos-start-title" className="display-heading">Sua operação começa aqui</h2></div><span>Do contato à entrega</span></div>
          <div className="hoikos-steps">{steps.map((step) => <div className="hoikos-step" key={step.number}><div className="hoikos-step-top"><span>{step.number}</span><step.icon aria-hidden="true" className="size-5" /></div><h3>{step.title}</h3><p>{step.description}</p><Button variant="link" onClick={() => step.editable && !step.done ? openCreate(step.kind) : setActiveModule(step.module)}>{step.done ? "Ver cadastros" : step.editable ? step.kind === "client" ? "Cadastrar cliente" : step.kind === "project" ? "Criar projeto" : "Criar tarefa" : "Abrir módulo"}{step.done ? <Check /> : <ArrowUpRight />}</Button></div>)}</div>
        </section>}
        <div className="hoikos-overview-columns">
          {(canView("tasks") || canView("schedule")) && <section className="hoikos-panel" aria-labelledby="hoikos-tasks-title"><div className="hoikos-section-heading"><h2 id="hoikos-tasks-title" className="display-heading">Próximas tarefas</h2>{canView("tasks") && <Button variant="link" onClick={() => setActiveModule("tasks")}>Ver todas<ArrowUpRight /></Button>}</div>
            {openTasks.length ? <div className="hoikos-task-list">{openTasks.slice(0, 5).map((task) => <div key={task.id} className="hoikos-task-row"><button disabled={!canEdit("tasks")} onClick={() => void completeTask(task)} aria-label={`Concluir ${task.title}`} className="hoikos-task-check"><Check className="size-3.5" /></button><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p><p className="text-xs text-hoikos-500">{task.projectName}{task.dueAt ? ` · ${new Date(task.dueAt).toLocaleDateString("pt-BR")}` : ""}</p></div><StatusBadge status={task.status} /></div>)}</div> : <div className="hoikos-panel-empty"><ListChecks aria-hidden="true" /><div><h3>{tasks.length ? "Todas as tarefas concluídas" : "Nenhuma tarefa por enquanto"}</h3><p>{projects.length ? "As próximas entregas do seu trabalho aparecem aqui." : "As tarefas aparecerão aqui quando seu primeiro projeto estiver organizado."}</p></div></div>}
          </section>}
          {canView("projects") && <section className="hoikos-panel" aria-labelledby="hoikos-projects-title"><div className="hoikos-section-heading"><h2 id="hoikos-projects-title" className="display-heading">Em andamento</h2><Button variant="link" onClick={() => setActiveModule("projects")}>Ver projetos<ArrowUpRight /></Button></div>
            {activeProjects.length ? <div className="hoikos-project-list">{activeProjects.slice(0, 3).map((project) => <Link key={project.id} className="hoikos-project-row" href={`/projetos/${project.id}`}><div><span className="text-xs text-hoikos-500">{project.code} · {project.phase}</span><h3>{project.name}</h3></div><ArrowUpRight aria-hidden="true" className="size-4" /><div className="hoikos-project-progress"><Progress value={project.progressPercent} /><span>{project.progressPercent}%</span></div></Link>)}</div> : <div className="hoikos-panel-empty"><FolderKanban aria-hidden="true" /><div><h3>Nenhum trabalho em andamento</h3><p>Acompanhe etapas e avanços dos seus projetos neste espaço.</p></div></div>}
          </section>}
        </div>
      </div>;
    }
    if (activeModule === "projects" || activeModule === "works") { const filtered = projects.filter((project) => activeModule === "works" ? project.kind === "work" : project.kind === "project"); return <div className="space-y-5"><PageIntro module={activeModule} action={canEdit("projects") ? () => openCreate("project", activeModule === "works" ? "work" : "project") : undefined} actionLabel={activeModule === "works" ? "Nova obra" : "Novo projeto"} />{filtered.length ? <ProjectTable projects={filtered} query={query} /> : <HonestEmpty icon={activeModule === "works" ? Building2 : FolderKanban} title={activeModule === "works" ? "Nenhuma obra cadastrada" : "Nenhum projeto cadastrado"} description="Cadastre o primeiro trabalho real desta empresa." action={canEdit("projects") ? () => openCreate("project", activeModule === "works" ? "work" : "project") : undefined} actionLabel={activeModule === "works" ? "Cadastrar obra" : "Cadastrar projeto"} />}</div>; }
    if (activeModule === "crm") return <CrmWorkspace key={session.organization?.id} clients={clients} members={members.map((member) => ({ id: member.id, name: member.name }))} query={query} canEdit={canEdit("crm")} canConvert={canEdit("projects")} onProjectsChanged={loadData} />;
    if (activeModule === "schedule") return <ScheduleWorkspace projects={projects} tasks={tasks} query={query} canEdit={canEdit("schedule") && canEdit("tasks")} onChanged={loadData} />;
    if (activeModule === "files") return <FilesWorkspace key={session.organization?.id} projects={projects} query={query} canEdit={canEdit("files")} />;
    if (activeModule === "prancheta") return <PranchetaWorkspace key={session.organization?.id} projects={projects} query={query} canEdit={canEdit("prancheta")} />;
    if (activeModule === "studio") return <div className="space-y-5"><PageIntro module="studio" /><EditorCadWorkspace key={session.organization?.id} projects={projects} query={query} canEdit={canEdit("studio")} /></div>;
    if (activeModule === "layout") return <LayoutWorkspace key={session.organization?.id} projects={projects} query={query} canEdit={canEdit("layout")} empresa={session.organization?.name ?? ""} />;
    if (activeModule === "comunicacao") return <ComunicacaoWorkspace key={session.organization?.id} canUseLibrary={canView("prancheta")} onUnread={setUnreadMessages} />;
    if (activeModule === "tasks") return <TasksWorkspace tasks={tasks} members={members} query={query} canEdit={canEdit("tasks")} onCreate={() => openCreate("task")} onChanged={loadData} />;
    if (activeModule === "team") return <div className="space-y-5"><PageIntro module="team" />{canView("tasks") && <TeamWorkload members={members} tasks={tasks} />}<TeamAccessManager key={session.organization?.id} currentMemberId={session.member?.id} members={members} canManage={podeAdministrarEmpresa(session.member?.role) && canEdit("team")} /></div>;
    if (activeModule === "finance") return <FinanceWorkspace key={session.organization?.id} projects={projects} query={query} canEdit={canEdit("finance")} canManageConnection={podeAdministrarEmpresa(session.member?.role) && canEdit("finance")} onProjectsChanged={loadData} />;
    if (activeModule === "budgets") return <BudgetsWorkspace key={session.organization?.id} projects={projects} query={query} canEdit={canEdit("budgets")} />;
    if (activeModule === "diary") return <DiaryWorkspace key={session.organization?.id} canEdit={canEdit("diary")} query={query} />;
    if (activeModule === "reminders") return <div className="space-y-5"><PageIntro module="reminders" /><RemindersWorkspace agenda={agenda} error={remindersError} reload={reloadReminders} mark={markReminder} members={members.map((member) => ({ id: member.id, name: member.name }))} /></div>;
    if (activeModule === "sheets") return <div className="space-y-5"><PageIntro module="sheets" /><WorksheetsWorkspace query={query} /></div>;
    if (activeModule === "usage") return <div className="space-y-5"><PageIntro module="usage" /><UsageWorkspace key={session.organization?.id} query={query} /></div>;
    if (activeModule === "portal") return <PortalManager key={session.organization?.id} canEdit={canEdit("portal")} canManage={canEdit("portal") && (session.member?.role === "owner" || session.member?.role === "superadmin" || (session.member?.role === "admin" && canEdit("team")))} canReadDiary={canView("diary")} />;
    return null;
  })();

  const allowedKinds = ([canEdit("crm") && "client", canEdit("projects") && "project", canEdit("tasks") && "task"].filter(Boolean) as CreateKind[]);
  return <SidebarProvider className="nexo-shell" style={{ "--sidebar-width": "17rem" } as React.CSSProperties}>
    <Sidebar collapsible="icon" className="nexo-sidebar border-r-0"><SidebarHeader className="p-3.5"><div className="group-data-[collapsible=icon]:hidden"><Brand variant="lockup" dark className="w-[186px]" /></div><div className="hidden group-data-[collapsible=icon]:block"><Brand variant="symbol" dark className="w-7" /></div><div className="mt-2 group-data-[collapsible=icon]:hidden"><Select value={session.organization?.id} onValueChange={(value) => void switchOrganization(value)}><SelectTrigger aria-label="Empresa atual" className="hoikos-company-select h-10 w-full text-left"><SelectValue /></SelectTrigger><SelectContent>{session.organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}</SelectContent></Select></div></SidebarHeader><SidebarSeparator /><SidebarContent className="px-1 py-2">{navSections.map((section) => <SidebarGroup key={section.label}><SidebarGroupLabel className="text-xs uppercase tracking-[0.16em] text-hoikos-500">{section.label}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{section.items.map((item) => <SidebarMenuItem key={item.id}><SidebarMenuButton tooltip={item.label} isActive={activeModule === item.id} onClick={() => setActiveModule(item.id)} className="h-10 rounded-lg text-hoikos-300 data-[active=true]:bg-hoikos-300 data-[active=true]:text-hoikos-950 hover:bg-white/[0.07] hover:text-white"><item.icon /><span>{item.label}</span></SidebarMenuButton>{item.badge ? <SidebarMenuBadge className={activeModule === item.id ? "text-hoikos-950" : "text-hoikos-500"}>{item.badge}</SidebarMenuBadge> : null}</SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>)}</SidebarContent><SidebarSeparator /><SidebarFooter className="p-3"><SidebarMenu>{session.member?.role === "owner" ? <SidebarMenuItem><SidebarMenuButton onClick={() => setCompanyOpen(true)} tooltip="Nova empresa" className="text-hoikos-300 hover:text-white"><Building2 /><span>Nova empresa</span></SidebarMenuButton></SidebarMenuItem> : null}<SidebarMenuItem><SidebarMenuButton size="lg" tooltip="Conta" className="text-hoikos-300 hover:text-white"><span className="grid size-9 place-items-center rounded-full bg-hoikos-300 text-xs font-semibold text-hoikos-950">{session.user?.displayName.slice(0, 2).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-white">{session.user?.displayName}</span><span className="block truncate text-xs text-hoikos-500">{roleLabels[session.member?.role ?? ""] ?? session.member?.role}</span></span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem>{session.authMethod === "superadmin" ? <SidebarMenuButton asChild tooltip="Painel da plataforma" className="text-hoikos-300 hover:text-white"><a href="/superadmin"><ShieldCheck /><span>Painel da plataforma</span></a></SidebarMenuButton> : session.authMethod === "maintenance" ? <SidebarMenuButton onClick={() => void logoutMaintenance()} tooltip="Sair" className="text-hoikos-500 hover:text-white"><LogOut /><span>Sair</span></SidebarMenuButton> : <SidebarMenuButton onClick={() => void logoutAccount()} tooltip="Sair" className="text-hoikos-500 hover:text-white"><LogOut /><span>Sair</span></SidebarMenuButton>}</SidebarMenuItem></SidebarMenu></SidebarFooter><SidebarRail /></Sidebar>
    <SidebarInset><header className="nexo-header sticky top-0 z-20 flex h-[4.5rem] items-center gap-3 border-b border-border px-4 sm:px-6"><SidebarTrigger className="size-10 rounded-md border border-hoikos-200 bg-white" /><p className="hidden text-sm font-semibold text-hoikos-700 sm:block">{moduleTitles[activeModule].title}</p>{(session.maintenanceEnvironment ?? session.authMethod === "maintenance") ? <Badge className="hidden border-hoikos-200 bg-hoikos-50 text-hoikos-800 sm:inline-flex">Ambiente de manutenção</Badge> : null}{session.authMethod === "superadmin" ? <Badge className="border-hoikos-800 bg-hoikos-900 text-white">Superadmin · acesso total</Badge> : null}<div className="mx-auto w-full max-w-md sm:ml-auto sm:mr-0"><div className="relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-hoikos-500" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar nesta empresa" placeholder="Buscar nesta empresa…" className="h-10 rounded-md bg-white pl-10" /></div></div><ReminderBell pending={pending} onOpen={() => setActiveModule("reminders")} />{canCreateAny ? <Button size="sm" aria-label="Criar" onClick={() => openCreate(canEdit("projects") ? "project" : canEdit("crm") ? "client" : "task")} className="rounded-md"><Plus /><span className="hidden sm:inline">Criar</span></Button> : null}</header><main data-module={activeModule} className="nexo-canvas min-h-[calc(100svh-4.5rem)] p-4 sm:p-6 lg:p-8"><div className="hoikos-workspace-content mx-auto max-w-[1480px]">{content}</div></main></SidebarInset>
    <QuickCreate key={`${quickKind}-${quickProjectKind}-${quickOpen}`} projectKind={quickProjectKind} open={quickOpen} onOpenChange={setQuickOpen} projects={projects} clients={clients} initialKind={quickKind} allowedKinds={allowedKinds} onCreated={loadData} />
    <Dialog open={companyOpen} onOpenChange={setCompanyOpen}><DialogContent><DialogHeader><DialogTitle>Nova empresa</DialogTitle><DialogDescription>Crie outro ambiente totalmente separado dos dados atuais.</DialogDescription></DialogHeader><OrganizationForm embedded onCreated={async () => { setCompanyOpen(false); await reloadSession(); }} /></DialogContent></Dialog>
  </SidebarProvider>;
}

function OrganizationChoice({ organizations, onSelected }: { organizations: Organization[]; onSelected: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function choose(organizationId: string) {
    setBusy(true); setError("");
    try { await requestJson("/api/session", { method: "POST", body: JSON.stringify({ organizationId }) }); await onSelected(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível selecionar."); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-svh place-items-center bg-hoikos-100 p-5"><Card className="w-full max-w-md"><CardHeader><CardTitle>Selecione sua empresa</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">O acesso à empresa selecionada anteriormente não está disponível. Escolha um dos seus vínculos autorizados.</p>{error && <p role="alert">{error}</p>}{organizations.map(organization => <Button key={organization.id} className="h-auto min-h-10 w-full whitespace-normal" disabled={busy} onClick={() => void choose(organization.id)}>{organization.name}</Button>)}</CardContent></Card></main>;
}

export function NexoApp() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const loadSession = useCallback(async () => { await Promise.resolve(); setLoading(true); try { setSession(await requestJson<SessionData>("/api/session")); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível abrir sua conta."); } finally { setLoading(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void loadSession(); }, 0); return () => window.clearTimeout(timer); }, [loadSession]);
  const ready = useMemo(() => session?.authenticated && !session.needsOrganization && session.organization, [session]);
  useUsageHeartbeat(Boolean(session?.authenticated && session.organization && !session.portalOnly));
  if (loading || !session) return <LoadingScreen />;
  if (!session.authenticated) return <AccessScreen />;
  if (session.organizationSelectionRequired) return <OrganizationChoice organizations={session.organizations} onSelected={loadSession} />;
  if (session.portalOnly) return <ClientPortalApp />;
  if (session.platformEmpty) return <PlatformEmptyScreen />;
  if (session.needsOrganization) return <OrganizationForm onCreated={loadSession} />;
  if (!ready) return <LoadingScreen />;
  if (session.terms && !session.terms.accepted) return <TermsGate version={session.terms.version} onAccepted={loadSession} />;
  return <Workspace session={session} reloadSession={loadSession} />;
}
