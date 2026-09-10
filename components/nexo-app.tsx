"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  Cloud,
  FileText,
  Files,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Target,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
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
import { QuickCreate } from "@/components/quick-create";
import {
  PROJECT_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type ProjectStatus as DomainProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/domain/enums";
import type {
  ProjectCard,
  TaskCard,
  WorkspaceSnapshot,
} from "@/lib/view/workspace";
// Módulos ainda sobre dados de demonstração. Cada tela que os usa é rotulada
// com `DemoNotice`; a Fase 1 migrou apenas cliente, projeto/obra e tarefa.
import {
  budgets,
  cashFlow,
  crmCards,
  demoFinancialSummary,
  files,
  opportunities,
  schedule,
} from "@/lib/demo-data";

type ModuleId =
  | "overview"
  | "projects"
  | "works"
  | "budgets"
  | "schedule"
  | "crm"
  | "finance"
  | "team"
  | "tasks"
  | "files";

type FinancialSummary = Omit<typeof demoFinancialSummary, "source"> & {
  source: "demo" | "drap";
  warning?: string;
};

type NavItem = {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Trabalho",
    items: [
      { id: "overview", label: "Visão geral", icon: LayoutDashboard },
      { id: "projects", label: "Projetos", icon: FolderKanban },
      { id: "works", label: "Obras", icon: Building2, badge: "2" },
      { id: "budgets", label: "Orçamentos", icon: Calculator },
      { id: "schedule", label: "Cronograma", icon: CalendarRange },
    ],
  },
  {
    label: "Negócio",
    items: [
      { id: "crm", label: "Vendas e clientes", icon: Target, badge: "2" },
      { id: "finance", label: "Financeiro", icon: WalletCards },
      { id: "team", label: "Equipe", icon: Users },
    ],
  },
  {
    label: "Organização",
    items: [
      { id: "tasks", label: "Tarefas", icon: ListChecks, badge: "6" },
      { id: "files", label: "Arquivos", icon: Files },
    ],
  },
];

const moduleTitles: Record<ModuleId, { title: string; description: string }> = {
  overview: {
    title: "Visão geral",
    description: "O que exige decisão hoje, sem ruído.",
  },
  projects: {
    title: "Projetos",
    description: "Escopo, entregas, horas e resultado de cada projeto.",
  },
  works: {
    title: "Obras",
    description: "Execução, medições, compras e registros de campo.",
  },
  budgets: {
    title: "Orçamentos",
    description: "Versões, custos, BDI, margem e aprovação do cliente.",
  },
  schedule: {
    title: "Cronograma",
    description: "Prazos conectados às tarefas e ao avanço físico.",
  },
  crm: {
    title: "Vendas e clientes",
    description: "Oportunidades, próximos contatos e propostas em aberto.",
  },
  finance: {
    title: "Financeiro",
    description: "Dados da Drap, exibidos aqui no contexto de cada trabalho.",
  },
  team: {
    title: "Equipe",
    description: "Capacidade, responsabilidades e horas planejadas.",
  },
  tasks: {
    title: "Tarefas",
    description: "Uma fila única, organizada por urgência e contexto.",
  },
  files: {
    title: "Arquivos",
    description: "Documentos e revisões vinculados ao trabalho certo.",
  },
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const compactCurrency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

function statusClasses(status: string) {
  if (["Em dia", "Aprovado", "Concluída"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["Atenção", "Em revisão", "Aguardando cliente"].includes(status)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-red-200 bg-red-50 text-red-700";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={statusClasses(status)}>
      {status}
    </Badge>
  );
}

/**
 * Marca de dado não real.
 *
 * O produto pode mostrar demonstração enquanto o módulo não foi migrado; o que
 * não pode é o usuário achar que o número é dele.
 */
function DemoNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
      <FlaskConical className="mt-px size-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

const PROJECT_STATUS_TONE: Record<DomainProjectStatus, string> = {
  active: "border-blue-200 bg-blue-50 text-blue-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
};

function ProjectStatusBadge({ status }: { status: DomainProjectStatus }) {
  return (
    <Badge variant="outline" className={PROJECT_STATUS_TONE[status]}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

const TASK_STATUS_TONE: Record<TaskStatus, string> = {
  todo: "border-slate-200 bg-slate-100 text-slate-600",
  doing: "border-blue-200 bg-blue-50 text-blue-700",
  blocked: "border-red-200 bg-red-50 text-red-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const TASK_PRIORITY_TONE: Record<TaskPriority, string> = {
  critical: "text-red-600",
  high: "text-amber-700",
  normal: "text-slate-500",
  low: "text-slate-400",
};

/**
 * Prazo em linguagem de decisão.
 *
 * Compara só a parte da data (o prazo é um dia, não um instante) para que
 * "vence hoje" não vire "atrasado" por causa do horário.
 */
function describeDue(dueAt: string | null): { label: string; overdue: boolean } | null {
  if (!dueAt) return null;

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const dueKey = dueAt.slice(0, 10);

  const days = Math.round(
    (Date.parse(`${dueKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000,
  );

  if (days < 0) {
    return { label: days === -1 ? "Venceu ontem" : `Atrasada ${Math.abs(days)} dias`, overdue: true };
  }
  if (days === 0) return { label: "Vence hoje", overdue: false };
  if (days === 1) return { label: "Vence amanhã", overdue: false };
  return { label: `Em ${days} dias`, overdue: false };
}

/** Formata uma data ISO curta (AAAA-MM-DD) sem deslocar por fuso. */
function formatDay(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return null;
  return `${day}/${month}/${year}`;
}


function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.035)] ${className}`}
    >
      {children}
    </section>
  );
}

function CardHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        {detail ? <p className="mt-0.5 text-[13px] text-slate-500">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "blue",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "blue" | "amber" | "emerald" | "slate";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <p className="metric-number mt-2 text-2xl font-semibold text-slate-950">{value}</p>
          <p className="mt-1 text-[13px] text-slate-500">{detail}</p>
        </div>
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
      </div>
    </Card>
  );
}

function PageIntro({
  module,
  actionLabel,
  onAction,
}: {
  module: ModuleId;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const copy = moduleTitles[module];
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-[13px] font-medium text-slate-500">
          {new Intl.DateTimeFormat("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          }).format(new Date())}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-[28px]">
          {copy.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{copy.description}</p>
      </div>
      {actionLabel ? (
        <Button onClick={onAction} className="self-start shadow-sm sm:self-auto">
          <Plus className="size-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function Overview({
  workspace,
  financial,
  onNavigate,
  onCreate,
}: {
  workspace: WorkspaceSnapshot;
  financial: FinancialSummary;
  onNavigate: (module: ModuleId) => void;
  onCreate: () => void;
}) {
  const { counts, projects } = workspace;
  const activeProjects = projects.filter((project) => project.status === "active");
  const projectCount = activeProjects.filter((project) => project.kind === "project").length;
  const workCount = activeProjects.filter((project) => project.kind === "work").length;

  // A fila é a razão desta tela: atrasadas primeiro, depois o que vence hoje.
  const queue = projects.length || counts.tasks.open ? buildDecisionQueue(workspace) : [];

  return (
    <div className="space-y-5">
      <PageIntro module="overview" actionLabel="Criar" onAction={onCreate} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={BriefcaseBusiness}
          label="Trabalhos ativos"
          value={String(activeProjects.length)}
          detail={`${projectCount} projetos · ${workCount} obras`}
        />
        <KpiCard
          icon={CircleAlert}
          label="Precisam de você"
          value={String(counts.tasks.overdue + counts.tasks.today)}
          detail={`${counts.tasks.overdue} atrasadas · ${counts.tasks.today} para hoje`}
          tone={counts.tasks.overdue > 0 ? "amber" : "slate"}
        />
        <KpiCard
          icon={ListChecks}
          label="Tarefas abertas"
          value={String(counts.tasks.open)}
          detail={
            counts.unassignedOpenTasks > 0
              ? `${counts.unassignedOpenTasks} sem responsável`
              : "todas com responsável"
          }
          tone="slate"
        />
        <KpiCard
          icon={CircleDollarSign}
          label="A receber"
          value={compactCurrency.format(financial.receivables)}
          detail={financial.source === "drap" ? "via Drap" : "demonstração · Drap não conectada"}
          tone="emerald"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
        <Card>
          <CardHeading
            title="Precisa de você agora"
            detail="Atrasos primeiro, depois o que vence hoje"
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("tasks")}>
                Ver tarefas
              </Button>
            }
          />
          {queue.length === 0 ? (
            <EmptyBlock
              title="Nada vencido ou bloqueando"
              description="Quando uma tarefa atrasar ou um trabalho ficar abaixo do previsto, ela aparece aqui."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {queue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.module)}
                  className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-slate-50/80"
                >
                  <span className="mt-0.5 shrink-0 text-slate-400">
                    <item.icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                    <p className="mt-0.5 text-[13px] text-slate-500">{item.context}</p>
                  </div>
                  <span
                    className={`shrink-0 text-[13px] font-medium ${
                      item.urgent ? "text-red-600" : "text-slate-700"
                    }`}
                  >
                    {item.note}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden bg-[#192235] text-white">
          <div className="blueprint-grid h-full p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-slate-300">
                  <Cloud className="size-4" />
                  Financeiro via Drap
                </div>
                <p className="metric-number mt-4 text-3xl font-semibold">
                  {currency.format(financial.currentBalance)}
                </p>
                <p className="mt-1 text-sm text-slate-300">Saldo consolidado</p>
              </div>
              <Badge className="border-white/10 bg-white/10 text-white hover:bg-white/10">
                {financial.source === "drap" ? "Sincronizado" : "Demonstração"}
              </Badge>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
              <div>
                <p className="text-xs text-slate-400">A pagar</p>
                <p className="metric-number mt-1 text-base font-medium">
                  {currency.format(financial.payables)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Projeção 30 dias</p>
                <p className="metric-number mt-1 text-base font-medium">
                  {currency.format(financial.projected30d)}
                </p>
              </div>
            </div>
            <button
              className="mt-5 flex items-center gap-2 text-sm font-medium text-blue-200 hover:text-white"
              onClick={() => onNavigate("finance")}
            >
              Abrir visão financeira <span aria-hidden="true">→</span>
            </button>
          </div>
        </Card>
      </div>

      <ProjectTable projects={projects} limit={4} onCreate={onCreate} canCreate={workspace.permissions["project:write"]} />
    </div>
  );
}

type QueueItem = {
  id: string;
  title: string;
  context: string;
  note: string;
  urgent: boolean;
  icon: LucideIcon;
  module: ModuleId;
};

/**
 * Monta a fila de decisões a partir dos dados reais.
 *
 * Ordem: tarefa atrasada, tarefa de hoje, tarefa bloqueada, trabalho sem
 * responsável. Cada item diz o que é e para onde ir — nada entra aqui sem ação.
 */
function buildDecisionQueue(workspace: WorkspaceSnapshot): QueueItem[] {
  const items: QueueItem[] = [];
  const describeTask = (task: TaskCard) => {
    const parts = [task.projectCode ? `${task.projectCode} · ${task.projectName}` : "Sem vínculo"];
    if (task.assigneeName) parts.push(task.assigneeName);
    return parts.join(" · ");
  };

  for (const task of workspace.tasks) {
    if (task.status === "done") continue;
    const due = describeDue(task.dueAt);

    if (due?.overdue) {
      items.push({
        id: `overdue-${task.id}`,
        title: task.title,
        context: describeTask(task),
        note: due.label,
        urgent: true,
        icon: CircleAlert,
        module: "tasks",
      });
    } else if (task.status === "blocked") {
      items.push({
        id: `blocked-${task.id}`,
        title: task.title,
        context: describeTask(task),
        note: "Bloqueada",
        urgent: true,
        icon: ShieldCheck,
        module: "tasks",
      });
    } else if (due?.label === "Vence hoje") {
      items.push({
        id: `today-${task.id}`,
        title: task.title,
        context: describeTask(task),
        note: due.label,
        urgent: false,
        icon: Clock3,
        module: "tasks",
      });
    }
  }

  for (const project of workspace.projects) {
    if (project.status !== "active" || project.ownerMemberId) continue;
    items.push({
      id: `unowned-${project.id}`,
      title: `${project.name} está sem responsável`,
      context: `${project.code} · ${project.clientName ?? "sem cliente"}`,
      note: "Definir responsável",
      urgent: false,
      icon: Users,
      module: project.kind === "work" ? "works" : "projects",
    });
  }

  return items.slice(0, 8);
}

/** Estado vazio padrão das listas, com a explicação do que faria aparecer algo. */
function EmptyBlock({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="max-w-sm text-[13px] text-slate-500">{description}</p>
      {actionLabel && onAction ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onAction}>
          <Plus className="size-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}


function ProjectTable({
  projects,
  limit,
  query = "",
  onCreate,
  canCreate,
}: {
  projects: ProjectCard[];
  limit?: number;
  query?: string;
  onCreate?: () => void;
  canCreate?: boolean;
}) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const matching = projects.filter(
    (project) =>
      !normalized ||
      `${project.name} ${project.clientName ?? ""} ${project.code} ${project.phase}`
        .toLocaleLowerCase("pt-BR")
        .includes(normalized),
  );
  const rows = matching.slice(0, limit);

  return (
    <Card className="overflow-hidden">
      <CardHeading
        title="Projetos e obras"
        detail={
          projects.length === 0
            ? "Nenhum trabalho cadastrado"
            : `${matching.length} de ${projects.length} trabalhos`
        }
      />
      {rows.length === 0 ? (
        <EmptyBlock
          title={
            projects.length === 0 ? "Nenhum trabalho ainda" : "Nenhum trabalho para esta busca"
          }
          description={
            projects.length === 0
              ? "Cadastre o primeiro projeto ou obra para acompanhar etapas, tarefas e prazos."
              : "Ajuste os termos da busca para encontrar o trabalho."
          }
          actionLabel={projects.length === 0 && canCreate ? "Novo trabalho" : undefined}
          onAction={onCreate}
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                <TableHead className="pl-5 text-xs text-slate-500">Trabalho</TableHead>
                <TableHead className="text-xs text-slate-500">Etapa</TableHead>
                <TableHead className="min-w-36 text-xs text-slate-500">Avanço</TableHead>
                <TableHead className="text-xs text-slate-500">Pendências</TableHead>
                <TableHead className="pr-5 text-right text-xs text-slate-500">Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                        {project.kind === "work" ? "OB" : "AR"}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{project.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {project.code} · {project.clientName ?? "sem cliente"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">{project.phase}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={project.progressPercent}
                        className="h-1.5 min-w-20 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600"
                      />
                      <span className="w-8 text-right text-xs tabular-nums text-slate-500">
                        {project.progressPercent}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {project.overdueTaskCount > 0 ? (
                      <span className="font-medium text-red-600">
                        {project.overdueTaskCount} atrasadas
                      </span>
                    ) : project.openTaskCount > 0 ? (
                      <span className="text-slate-600">{project.openTaskCount} abertas</span>
                    ) : (
                      <span className="text-slate-400">sem pendência</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <ProjectStatusBadge status={project.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}


function ProjectsView({
  workspace,
  query,
  onCreate,
}: {
  workspace: WorkspaceSnapshot;
  query: string;
  onCreate: () => void;
}) {
  const projects = workspace.projects.filter((project) => project.kind === "project");
  const active = projects.filter((project) => project.status === "active");
  const overdue = projects.reduce((total, project) => total + project.overdueTaskCount, 0);
  const contracted = projects.reduce((total, project) => total + project.budgetCents, 0);

  return (
    <div className="space-y-5">
      <PageIntro
        module="projects"
        actionLabel={workspace.permissions["project:write"] ? "Novo projeto" : undefined}
        onAction={onCreate}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          icon={FolderKanban}
          label="Em andamento"
          value={String(active.length)}
          detail={`${projects.length} no total`}
        />
        <KpiCard
          icon={CircleAlert}
          label="Tarefas atrasadas"
          value={String(overdue)}
          detail={overdue > 0 ? "exigem replanejamento" : "nenhum atraso"}
          tone={overdue > 0 ? "amber" : "slate"}
        />
        <KpiCard
          icon={CircleDollarSign}
          label="Contratado"
          value={compactCurrency.format(contracted / 100)}
          detail="soma dos projetos"
          tone="emerald"
        />
      </div>
      <ProjectTable
        projects={projects}
        query={query}
        onCreate={onCreate}
        canCreate={workspace.permissions["project:write"]}
      />
    </div>
  );
}


function WorksView({
  workspace,
  query,
  onCreate,
}: {
  workspace: WorkspaceSnapshot;
  query: string;
  onCreate: () => void;
}) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const works = workspace.projects
    .filter((project) => project.kind === "work")
    .filter(
      (project) =>
        !normalized ||
        `${project.name} ${project.clientName ?? ""} ${project.code}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized),
    );

  return (
    <div className="space-y-5">
      <PageIntro
        module="works"
        actionLabel={workspace.permissions["project:write"] ? "Nova obra" : undefined}
        onAction={onCreate}
      />

      {works.length === 0 ? (
        <Card>
          <EmptyBlock
            title="Nenhuma obra cadastrada"
            description="Cadastre uma obra para registrar diário, medições, compras e avanço de campo."
            actionLabel={workspace.permissions["project:write"] ? "Nova obra" : undefined}
            onAction={onCreate}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {works.map((work) => {
            const target = formatDay(work.targetDate);
            return (
              <Card key={work.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-blue-600">{work.code}</p>
                    <h2 className="mt-1 truncate text-lg font-semibold text-slate-950">
                      {work.name}
                    </h2>
                    <p className="mt-1 truncate text-sm text-slate-500">
                      {work.clientName ?? "sem cliente"} ·{" "}
                      {work.ownerName ? `Responsável: ${work.ownerName}` : "sem responsável"}
                    </p>
                  </div>
                  <ProjectStatusBadge status={work.status} />
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex justify-between text-[13px]">
                    <span className="font-medium text-slate-700">{work.phase}</span>
                    <span className="tabular-nums text-slate-500">
                      {work.progressPercent}% concluído
                    </span>
                  </div>
                  <Progress
                    value={work.progressPercent}
                    className="h-2 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600"
                  />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-xs text-slate-400">Contratado</p>
                    <p className="mt-1 text-sm font-semibold">
                      {compactCurrency.format(work.budgetCents / 100)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Entrega</p>
                    <p className="mt-1 text-sm font-semibold">{target ?? "a definir"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Pendências</p>
                    <p
                      className={`mt-1 text-sm font-semibold ${
                        work.overdueTaskCount > 0 ? "text-red-600" : ""
                      }`}
                    >
                      {work.overdueTaskCount > 0
                        ? `${work.overdueTaskCount} atrasadas`
                        : `${work.openTaskCount} abertas`}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}


function BudgetsView({ onAction }: { onAction: () => void }) {
  return (
    <div className="space-y-5">
      <PageIntro module="budgets" actionLabel="Novo orçamento" onAction={onAction} />
      <DemoNotice>
        Orçamentos ainda são demonstração. A Fase 2 entrega composições, BDI por serviço,
        margem mínima, versões imutáveis e aprovação do cliente.
      </DemoNotice>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={Calculator} label="Em negociação" value="R$ 238 mil" detail="2 propostas com cliente" />
        <KpiCard icon={CircleDollarSign} label="Margem média" value="31,3%" detail="meta mínima: 28%" tone="emerald" />
        <KpiCard icon={CheckCircle2} label="Conversão" value="42%" detail="últimos 90 dias" tone="slate" />
      </div>
      <Card className="overflow-hidden">
        <CardHeading title="Orçamentos recentes" detail="Cada revisão preserva sua versão anterior" />
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
              <TableHead className="pl-5 text-xs text-slate-500">Orçamento</TableHead>
              <TableHead className="text-xs text-slate-500">Versão</TableHead>
              <TableHead className="text-xs text-slate-500">Valor</TableHead>
              <TableHead className="text-xs text-slate-500">Margem</TableHead>
              <TableHead className="text-xs text-slate-500">Atualização</TableHead>
              <TableHead className="pr-5 text-right text-xs text-slate-500">Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {budgets.map((budget) => (
              <TableRow key={budget.id}>
                <TableCell className="pl-5"><p className="text-sm font-medium text-slate-900">{budget.title}</p><p className="text-xs text-slate-500">{budget.code} · {budget.client}</p></TableCell>
                <TableCell><Badge variant="secondary">{budget.version}</Badge></TableCell>
                <TableCell className="font-medium tabular-nums">{currency.format(budget.value)}</TableCell>
                <TableCell className="tabular-nums text-slate-600">{budget.margin}%</TableCell>
                <TableCell className="text-[13px] text-slate-500">{budget.updatedAt}</TableCell>
                <TableCell className="pr-5 text-right"><StatusBadge status={budget.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FinanceView({ financial }: { financial: FinancialSummary }) {
  const max = Math.max(...cashFlow.flatMap((month) => [month.income, month.expense]));
  return (
    <div className="space-y-5">
      <PageIntro module="finance" />
      <DemoNotice>
        A Drap é a fonte oficial do financeiro. Enquanto as credenciais e o contrato real não
        forem fornecidos, os valores abaixo são demonstrativos — a Fase 4 homologa o conector
        em sandbox e vincula cada projeto a um centro de custo remoto.
      </DemoNotice>
      <Card className="border-blue-200 bg-blue-50/50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-blue-100 text-blue-700"><Cloud className="size-[18px]" /></span>
            <div><p className="text-sm font-semibold text-slate-900">Conector financeiro {financial.source === "drap" ? "ativo" : "em demonstração"}</p><p className="mt-0.5 text-[13px] text-slate-600">A Drap continua sendo a fonte oficial; os dados aparecem dentro deste fluxo.</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}><RefreshCw className="size-4" /> Atualizar</Button>
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={WalletCards} label="Saldo atual" value={compactCurrency.format(financial.currentBalance)} detail="todas as contas" />
        <KpiCard icon={CircleDollarSign} label="A receber" value={compactCurrency.format(financial.receivables)} detail={`${compactCurrency.format(financial.overdueReceivables)} vencidos`} tone="emerald" />
        <KpiCard icon={FileText} label="A pagar" value={compactCurrency.format(financial.payables)} detail="próximos 30 dias" tone="amber" />
        <KpiCard icon={BriefcaseBusiness} label="Saldo projetado" value={compactCurrency.format(financial.projected30d)} detail="em 30 dias" tone="slate" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <Card>
          <CardHeading title="Fluxo de caixa" detail="Realizado até setembro · outubro projetado" />
          <div className="p-5">
            <div className="flex h-52 items-end gap-3 sm:gap-6">
              {cashFlow.map((month) => (
                <div key={month.label} className="flex h-full flex-1 flex-col justify-end">
                  <div className="flex h-[170px] items-end justify-center gap-1.5">
                    <div className="w-3.5 rounded-t bg-blue-600 sm:w-5" style={{ height: `${(month.income / max) * 100}%` }} title={`Receitas: R$ ${month.income} mil`} />
                    <div className="w-3.5 rounded-t bg-slate-300 sm:w-5" style={{ height: `${(month.expense / max) * 100}%` }} title={`Despesas: R$ ${month.expense} mil`} />
                  </div>
                  <p className="mt-2 text-center text-xs text-slate-500">{month.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-center gap-5 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-blue-600" />Receitas</span><span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-slate-300" />Despesas</span></div>
          </div>
        </Card>
        <Card>
          <CardHeading title="Contas que pedem ação" detail="Ordenadas por vencimento" />
          <div className="divide-y divide-slate-100">
            {[
              ["Cliente Casa Cedro", "Parcela vencida", 18400, "Vencida há 3 dias"],
              ["Marmoraria Prisma", "Conta a pagar", 12800, "Vence amanhã"],
              ["Átrio Saúde", "Medição a faturar", 24800, "Liberada hoje"],
            ].map(([name, type, value, due]) => (
              <div key={String(name)} className="p-4">
                <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-slate-900">{name}</p><p className="mt-0.5 text-xs text-slate-500">{type}</p></div><p className="text-sm font-semibold tabular-nums">{currency.format(Number(value))}</p></div>
                <p className={`mt-2 text-xs ${String(due).startsWith("Vencida") ? "text-red-600" : "text-slate-500"}`}>{due}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function CrmView({
  workspace,
  query,
  onCreate,
}: {
  workspace: WorkspaceSnapshot;
  query: string;
  onCreate: () => void;
}) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const clients = workspace.clients.filter(
    (client) =>
      !normalized ||
      `${client.name} ${client.email ?? ""} ${client.document ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(normalized),
  );

  return (
    <div className="space-y-5">
      <PageIntro
        module="crm"
        actionLabel={workspace.permissions["client:write"] ? "Novo cliente" : undefined}
        onAction={onCreate}
      />

      <Card className="overflow-hidden">
        <CardHeading
          title="Clientes"
          detail={
            workspace.clients.length === 0
              ? "Nenhum cliente cadastrado"
              : `${clients.length} de ${workspace.clients.length} clientes`
          }
        />
        {clients.length === 0 ? (
          <EmptyBlock
            title={
              workspace.clients.length === 0
                ? "Nenhum cliente ainda"
                : "Nenhum cliente para esta busca"
            }
            description={
              workspace.clients.length === 0
                ? "O cliente é o início do fluxo: dele saem propostas, projetos e obras."
                : "Ajuste os termos da busca."
            }
            actionLabel={
              workspace.clients.length === 0 && workspace.permissions["client:write"]
                ? "Novo cliente"
                : undefined
            }
            onAction={onCreate}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                  <TableHead className="pl-5 text-xs text-slate-500">Cliente</TableHead>
                  <TableHead className="text-xs text-slate-500">Contato</TableHead>
                  <TableHead className="pr-5 text-right text-xs text-slate-500">
                    Trabalhos
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="pl-5">
                      <p className="text-sm font-medium text-slate-900">{client.name}</p>
                      {client.document ? (
                        <p className="text-xs text-slate-500">{client.document}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-[13px] text-slate-600">
                      {client.email ?? client.phone ?? "—"}
                    </TableCell>
                    <TableCell className="pr-5 text-right text-[13px] text-slate-600">
                      {client.projectCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <DemoNotice>
        O funil comercial ainda é demonstração. A Fase 2 do roadmap implementa
        oportunidades, histórico de atividades e conversão em projeto sem recadastro.
      </DemoNotice>

      <div className="grid gap-4 lg:grid-cols-4">
        {opportunities.map((stage) => stage.stage).map((stage) => {
          const cards = crmCards.filter((card) => card.stage === stage);
          const total = cards.reduce((sum, card) => sum + card.value, 0);
          return (
            <Card key={stage} className="bg-slate-50/60 p-3">
              <div className="flex items-baseline justify-between px-1 pb-2">
                <p className="text-[13px] font-semibold text-slate-700">{stage}</p>
                <span className="text-xs text-slate-500">{compactCurrency.format(total)}</span>
              </div>
              <div className="space-y-2">
                {cards.map((card) => (
                  <div key={card.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[13px] font-medium text-slate-900">{card.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{card.client}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-slate-900">
                        {compactCurrency.format(card.value)}
                      </span>
                      <span className="text-xs text-slate-400">{card.next}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


function TeamView({ workspace }: { workspace: WorkspaceSnapshot }) {
  return (
    <div className="space-y-5">
      <PageIntro module="team" />
      <Card className="overflow-hidden">
        <CardHeading
          title="Capacidade da equipe"
          detail="Horas contratadas na semana contra o que está aberto e apontado"
        />
        <div className="divide-y divide-slate-100">
          {workspace.members.map((member) => {
            const capacityHours = Math.round(member.weeklyCapacityMinutes / 60);
            const loggedHours = Math.round(member.loggedMinutes7d / 60);
            const load = capacityHours > 0 ? Math.round((loggedHours / capacityHours) * 100) : 0;

            return (
              <div
                key={member.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {initialsOf(member.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{member.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {roleLabel(member.role)} · {member.openTaskCount} tarefas abertas
                  </p>
                </div>
                <div className="flex items-center gap-3 sm:w-56">
                  <Progress
                    value={Math.min(100, load)}
                    className={`h-1.5 flex-1 bg-slate-100 ${
                      load > 100
                        ? "[&_[data-slot=progress-indicator]]:bg-red-500"
                        : "[&_[data-slot=progress-indicator]]:bg-blue-600"
                    }`}
                  />
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {loggedHours}h / {capacityHours}h
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <DemoNotice>
        Convite de integrante, permissões por projeto e horas planejadas entram junto com a
        Fase 2. A carga acima já vem dos apontamentos reais da empresa.
      </DemoNotice>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase("pt-BR");
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase("pt-BR");
}

const ROLE_LABELS_PT: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gestor",
  member: "Integrante",
  partner: "Parceiro",
  client: "Cliente",
};

function roleLabel(role: string): string {
  return ROLE_LABELS_PT[role] ?? role;
}


function TasksView({
  workspace,
  query,
  onCreate,
  onToggleTask,
  pendingTaskId,
}: {
  workspace: WorkspaceSnapshot;
  query: string;
  onCreate: () => void;
  onToggleTask: (task: TaskCard) => void;
  pendingTaskId: string | null;
}) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const { counts } = workspace;

  const tasks = workspace.tasks
    .filter((task) => task.status !== "done")
    .filter(
      (task) =>
        !normalized ||
        `${task.title} ${task.projectName ?? ""} ${task.assigneeName ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized),
    );

  return (
    <div className="space-y-5">
      <PageIntro
        module="tasks"
        actionLabel={workspace.permissions["task:write"] ? "Nova tarefa" : undefined}
        onAction={onCreate}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard
          icon={CircleAlert}
          label="Atrasadas"
          value={String(counts.tasks.overdue)}
          detail={counts.tasks.overdue > 0 ? "resolver primeiro" : "nenhuma"}
          tone={counts.tasks.overdue > 0 ? "amber" : "slate"}
        />
        <KpiCard
          icon={Clock3}
          label="Para hoje"
          value={String(counts.tasks.today)}
          detail="com prazo hoje"
        />
        <KpiCard
          icon={ListChecks}
          label="Abertas"
          value={String(counts.tasks.open)}
          detail={
            counts.unassignedOpenTasks > 0
              ? `${counts.unassignedOpenTasks} sem responsável`
              : "todas atribuídas"
          }
          tone="slate"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Concluídas"
          value={String(counts.tasks.doneLast7Days)}
          detail="nos últimos 7 dias"
          tone="emerald"
        />
      </div>

      <Card>
        <CardHeading
          title="Fila de execução"
          detail="Prioridade primeiro, prazo depois — a mesma regra usada no servidor"
        />
        {tasks.length === 0 ? (
          <EmptyBlock
            title={
              workspace.tasks.length === 0 ? "Nenhuma tarefa ainda" : "Nada aberto para esta busca"
            }
            description={
              workspace.tasks.length === 0
                ? "Crie a primeira tarefa para acompanhar prazo, responsável e vínculo com o trabalho."
                : "Todas as tarefas correspondentes já estão concluídas."
            }
            actionLabel={
              workspace.tasks.length === 0 && workspace.permissions["task:write"]
                ? "Nova tarefa"
                : undefined
            }
            onAction={onCreate}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {tasks.map((task) => {
              const due = describeDue(task.dueAt);
              const pending = pendingTaskId === task.id;

              return (
                <div
                  key={task.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <button
                    type="button"
                    aria-label={`Concluir ${task.title}`}
                    disabled={pending || !workspace.permissions["task:write"]}
                    onClick={() => onToggleTask(task)}
                    className="grid size-5 shrink-0 place-items-center rounded-full border border-slate-300 text-transparent hover:border-blue-500 hover:text-blue-500 disabled:opacity-40"
                  >
                    {pending ? (
                      <Spinner className="size-3 text-slate-500" />
                    ) : (
                      <Check className="size-3" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{task.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {task.projectCode ? `${task.projectCode} · ${task.projectName}` : "Sem vínculo"}
                    </p>
                  </div>
                  <Badge variant="outline" className={TASK_STATUS_TONE[task.status]}>
                    {TASK_STATUS_LABELS[task.status]}
                  </Badge>
                  <Badge variant="outline" className="self-start sm:self-auto">
                    {task.assigneeName ?? "a definir"}
                  </Badge>
                  <div className="w-36 text-left sm:text-right">
                    <p
                      className={`text-[13px] font-medium ${
                        due?.overdue ? "text-red-600" : "text-slate-700"
                      }`}
                    >
                      {due?.label ?? "sem prazo"}
                    </p>
                    <p className={`text-xs ${TASK_PRIORITY_TONE[task.priority]}`}>
                      {TASK_PRIORITY_LABELS[task.priority]}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}


function FilesView({ onAction }: { onAction: () => void }) {
  return (
    <div className="space-y-5">
      <PageIntro module="files" actionLabel="Enviar arquivo" onAction={onAction} />
      <DemoNotice>
        Arquivos ainda são demonstração. O binário vai para o R2 e os metadados para o banco;
        revisão, pasta por projeto e acesso do cliente entram na Fase 3.
      </DemoNotice>
      <div className="grid gap-3 sm:grid-cols-3">
        {[{ label: "Projetos", count: "184 arquivos", icon: FolderKanban }, { label: "Obras", count: "362 arquivos", icon: Building2 }, { label: "Modelos do escritório", count: "28 arquivos", icon: Archive }].map((folder) => (
          <Card key={folder.label} className="flex cursor-pointer items-center gap-3 p-4 hover:border-blue-300"><span className="grid size-10 place-items-center rounded-lg bg-blue-50 text-blue-700"><folder.icon className="size-5" /></span><div><p className="text-sm font-medium text-slate-900">{folder.label}</p><p className="text-xs text-slate-500">{folder.count}</p></div></Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <CardHeading title="Atualizados recentemente" detail="Revisões mais novas primeiro" />
        <Table>
          <TableHeader><TableRow className="bg-slate-50/70 hover:bg-slate-50/70"><TableHead className="pl-5 text-xs text-slate-500">Arquivo</TableHead><TableHead className="text-xs text-slate-500">Trabalho</TableHead><TableHead className="text-xs text-slate-500">Tamanho</TableHead><TableHead className="text-xs text-slate-500">Responsável</TableHead><TableHead className="pr-5 text-right text-xs text-slate-500">Atualização</TableHead></TableRow></TableHeader>
          <TableBody>{files.map((file) => <TableRow key={file.name}><TableCell className="pl-5"><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-600"><Paperclip className="size-4" /></span><div><p className="text-sm font-medium text-slate-900">{file.name}</p><p className="text-xs text-slate-500">{file.type}</p></div></div></TableCell><TableCell className="text-[13px] text-slate-600">{file.project}</TableCell><TableCell className="text-[13px] text-slate-500">{file.size}</TableCell><TableCell className="text-[13px] text-slate-600">{file.author}</TableCell><TableCell className="pr-5 text-right text-[13px] text-slate-500">{file.updatedAt}</TableCell></TableRow>)}</TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ScheduleView() {
  return (
    <div className="space-y-5">
      <PageIntro module="schedule" />
      <DemoNotice>
        O cronograma ainda é demonstração. A Fase 3 implementa etapas, dependências,
        recálculo e previsto contra realizado.
      </DemoNotice>
      <Card className="overflow-hidden">
        <CardHeading title="Planejamento integrado" detail="6 semanas · 01 set a 12 out" action={<Button variant="outline" size="sm">Hoje</Button>} />
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[210px_1fr] border-b border-slate-200 bg-slate-50/70">
              <div className="border-r border-slate-200 px-5 py-3 text-xs font-medium text-slate-500">Etapa</div>
              <div className="grid grid-cols-6">{["01–07 set", "08–14 set", "15–21 set", "22–28 set", "29 set–05 out", "06–12 out"].map((week) => <div key={week} className="border-r border-slate-200 px-2 py-3 text-center text-xs text-slate-500 last:border-r-0">{week}</div>)}</div>
            </div>
            <div className="divide-y divide-slate-100">
              {schedule.map((item) => (
                <div key={`${item.project}-${item.label}`} className="grid grid-cols-[210px_1fr]">
                  <div className="border-r border-slate-200 px-5 py-3"><p className="text-[13px] font-medium text-slate-800">{item.label}</p><p className="text-xs text-slate-500">{item.project}</p></div>
                  <div className="blueprint-grid relative my-3 h-9">
                    <div className="absolute top-1 h-7 overflow-hidden rounded-md border border-blue-300 bg-blue-100" style={{ left: `${item.start}%`, width: `${item.span}%` }}>
                      <div className="h-full bg-blue-600/80" style={{ width: `${item.progress}%` }} />
                      <span className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold text-slate-800">{item.progress}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}


/**
 * Confere o resumo financeiro recebido da própria API.
 *
 * `Response.json()` devolve `unknown`, e é assim que deve ser: o corpo vem da
 * rede. Os campos monetários precisam ser números finitos — um `null` ou uma
 * string atravessariam o `Intl.NumberFormat` como "NaN" na tela.
 */
function isFinancialSummary(value: unknown): value is FinancialSummary {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;

  const numericFields = [
    "currentBalance",
    "receivables",
    "payables",
    "projected30d",
    "overdueReceivables",
  ] as const;

  for (const field of numericFields) {
    if (typeof candidate[field] !== "number" || !Number.isFinite(candidate[field])) return false;
  }

  return (
    typeof candidate.updatedAt === "string" &&
    (candidate.source === "drap" || candidate.source === "demo")
  );
}

export function NexoApp({ workspace }: { workspace: WorkspaceSnapshot }) {
  const router = useRouter();
  const [activeModule, setActiveModule] = useState<ModuleId>("overview");
  const [query, setQuery] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [financial, setFinancial] = useState<FinancialSummary>(demoFinancialSummary);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations/drap/summary", { signal: controller.signal })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("Finance unavailable")),
      )
      .then((data: unknown) => {
        // A resposta é conferida antes de entrar na tela. Um corpo fora do
        // formato esperado viraria NaN nos valores monetários, o que é pior do
        // que mostrar o fallback marcado como demonstração.
        if (!isFinancialSummary(data)) throw new Error("Finance payload inválido");
        setFinancial(data);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setFinancial(demoFinancialSummary);
      });
    return () => controller.abort();
  }, []);

  /**
   * Conclui ou reabre uma tarefa.
   *
   * O estado da tela não é remendado otimistamente: a API responde, o servidor
   * recarrega o retrato. Assim uma falha de rede não deixa a interface mostrando
   * "concluída" enquanto o banco diz o contrário.
   */
  async function handleToggleTask(task: TaskCard) {
    setPendingTaskId(task.id);
    const nextStatus = task.status === "done" ? "todo" : "done";

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        toast.error("A tarefa não foi atualizada", {
          description: body?.error?.message ?? "Tente novamente.",
        });
        return;
      }

      toast.success(nextStatus === "done" ? "Tarefa concluída" : "Tarefa reaberta", {
        description: task.title,
      });
      router.refresh();
    } catch {
      toast.error("Falha de conexão", { description: "Nada foi salvo." });
    } finally {
      setPendingTaskId(null);
    }
  }

  async function handleSwitchOrganization(organizationId: string) {
    if (organizationId === workspace.organization.id) return;

    try {
      const response = await fetch("/api/organizations/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });

      if (!response.ok) {
        toast.error("Não foi possível trocar de empresa");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Falha de conexão ao trocar de empresa");
    }
  }

  const activeLabel = useMemo(() => moduleTitles[activeModule].title, [activeModule]);
  const openCreate = () => setQuickOpen(true);

  const content = (() => {
    switch (activeModule) {
      case "overview":
        return (
          <Overview
            workspace={workspace}
            financial={financial}
            onNavigate={setActiveModule}
            onCreate={openCreate}
          />
        );
      case "projects":
        return <ProjectsView workspace={workspace} query={query} onCreate={openCreate} />;
      case "works":
        return <WorksView workspace={workspace} query={query} onCreate={openCreate} />;
      case "budgets":
        return <BudgetsView onAction={openCreate} />;
      case "schedule":
        return <ScheduleView />;
      case "crm":
        return <CrmView workspace={workspace} query={query} onCreate={openCreate} />;
      case "finance":
        return <FinanceView financial={financial} />;
      case "team":
        return <TeamView workspace={workspace} />;
      case "tasks":
        return (
          <TasksView
            workspace={workspace}
            query={query}
            onCreate={openCreate}
            onToggleTask={handleToggleTask}
            pendingTaskId={pendingTaskId}
          />
        );
      case "files":
        return <FilesView onAction={openCreate} />;
    }
  })();

  // Contadores da navegação saem dos dados reais: um badge fixo mentiria.
  const badges: Partial<Record<ModuleId, string>> = {
    works: countOrUndefined(
      workspace.projects.filter((project) => project.kind === "work" && project.status === "active")
        .length,
    ),
    projects: countOrUndefined(
      workspace.projects.filter(
        (project) => project.kind === "project" && project.status === "active",
      ).length,
    ),
    crm: countOrUndefined(workspace.clients.length),
    tasks: countOrUndefined(workspace.counts.tasks.overdue + workspace.counts.tasks.today),
  };

  return (
    <SidebarProvider style={{ "--sidebar-width": "15.75rem" } as React.CSSProperties}>
      <Sidebar collapsible="icon" className="border-r-0">
        <SidebarHeader className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-12 items-center gap-3 overflow-hidden rounded-lg px-2 text-left hover:bg-sidebar-accent"
                aria-label="Selecionar empresa"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-500 text-sm font-bold text-white">
                  N
                </span>
                <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <span className="block truncate text-sm font-semibold text-white">Nexo Obra</span>
                  <span className="block truncate text-xs text-slate-400">
                    {workspace.organization.name}
                  </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-slate-500 group-data-[collapsible=icon]:hidden" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel>Suas empresas</DropdownMenuLabel>
              {workspace.organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onSelect={() => void handleSwitchOrganization(organization.id)}
                >
                  <span className="flex-1 truncate">{organization.name}</span>
                  {organization.id === workspace.organization.id ? (
                    <Check className="size-4 text-blue-600" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent className="px-1 py-2">
          {navSections.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel className="uppercase tracking-[0.12em] text-slate-500">
                {section.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={activeModule === item.id}
                        onClick={() => setActiveModule(item.id)}
                        className="h-9 text-slate-300 data-[active=true]:bg-blue-500 data-[active=true]:text-white hover:text-white"
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {badges[item.id] ? (
                        <SidebarMenuBadge
                          className={activeModule === item.id ? "text-white" : "text-slate-400"}
                        >
                          {badges[item.id]}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter className="p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Configurações" className="text-slate-300 hover:text-white">
                <Settings2 />
                <span>Configurações</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip={workspace.user.displayName}
                className="mt-1 text-slate-300 hover:text-white"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-700 text-xs font-semibold text-white">
                  {initialsOf(workspace.user.displayName)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">
                    {workspace.user.displayName}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {roleLabel(workspace.organization.role)}
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/90 bg-white/95 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger className="size-9" />
          <div className="hidden h-5 w-px bg-slate-200 sm:block" />
          <p className="hidden text-sm font-medium text-slate-700 sm:block">{activeLabel}</p>
          <div className="mx-auto w-full max-w-md sm:ml-auto sm:mr-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar trabalhos, clientes, tarefas..."
                aria-label="Buscar"
                className="h-9 bg-slate-50 pl-9 shadow-none"
              />
            </div>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Criar</span>
          </Button>
        </header>

        <main className="blueprint-grid min-h-[calc(100svh-4rem)] p-4 sm:p-6 lg:p-7">
          <div className="mx-auto max-w-[1480px]">{content}</div>
        </main>
      </SidebarInset>

      <QuickCreate
        open={quickOpen}
        onOpenChange={setQuickOpen}
        clients={workspace.clients}
        projects={workspace.projects}
        members={workspace.members}
        permissions={{
          clientWrite: workspace.permissions["client:write"],
          projectWrite: workspace.permissions["project:write"],
          taskWrite: workspace.permissions["task:write"],
        }}
      />
      <Toaster position="bottom-right" />
    </SidebarProvider>
  );
}

/** Badge só existe quando há algo para contar. Zero não merece um selo. */
function countOrUndefined(value: number): string | undefined {
  return value > 0 ? String(value) : undefined;
}

