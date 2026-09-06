"use client";

import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Bell,
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
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import {
  budgets,
  cashFlow,
  crmCards,
  demoFinancialSummary,
  files,
  focusTasks,
  opportunities,
  projects,
  schedule,
  team,
  type ProjectStatus,
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

function statusClasses(status: ProjectStatus | string) {
  if (["Em dia", "Aprovado", "Concluída"].includes(status)) {
    return "border-emerald-200/80 bg-emerald-50/90 text-emerald-700 shadow-[0_5px_14px_-10px_rgba(5,150,105,0.8)]";
  }
  if (["Atenção", "Em revisão", "Aguardando cliente"].includes(status)) {
    return "border-amber-200/80 bg-amber-50/90 text-amber-700 shadow-[0_5px_14px_-10px_rgba(217,119,6,0.8)]";
  }
  return "border-red-200/80 bg-red-50/90 text-red-700 shadow-[0_5px_14px_-10px_rgba(220,38,38,0.8)]";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClasses(status)}`}>
      {status}
    </Badge>
  );
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
      className={`workspace-card relative rounded-[1.25rem] border border-white/90 bg-white/90 ring-1 ring-slate-900/[0.035] backdrop-blur-sm transition duration-300 hover:-translate-y-0.5 ${className}`}
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
    <div className="flex items-start justify-between gap-4 border-b border-slate-200/60 px-5 py-[1.125rem] sm:px-6">
      <div>
        <h2 className="display-heading text-base font-semibold tracking-[-0.015em] text-slate-950">{title}</h2>
        {detail ? <p className="mt-1 text-[13px] leading-5 text-slate-500">{detail}</p> : null}
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
    blue: {
      icon: "bg-blue-600 text-white shadow-[0_8px_20px_-10px_rgba(37,99,235,0.9)]",
      wash: "from-blue-50/80 via-white/90 to-white/90",
      accent: "bg-blue-500",
    },
    amber: {
      icon: "bg-amber-500 text-white shadow-[0_8px_20px_-10px_rgba(245,158,11,0.9)]",
      wash: "from-amber-50/80 via-white/90 to-white/90",
      accent: "bg-amber-400",
    },
    emerald: {
      icon: "bg-emerald-600 text-white shadow-[0_8px_20px_-10px_rgba(5,150,105,0.9)]",
      wash: "from-emerald-50/80 via-white/90 to-white/90",
      accent: "bg-emerald-500",
    },
    slate: {
      icon: "bg-slate-800 text-white shadow-[0_8px_20px_-10px_rgba(30,41,59,0.85)]",
      wash: "from-slate-100/80 via-white/90 to-white/90",
      accent: "bg-slate-500",
    },
  };
  const selectedTone = tones[tone];

  return (
    <Card className={`overflow-hidden bg-gradient-to-br p-4 sm:p-5 ${selectedTone.wash}`}>
      <span className={`absolute inset-y-5 left-0 w-1 rounded-r-full ${selectedTone.accent}`} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
          <p className="metric-number display-heading mt-2.5 text-[1.75rem] font-semibold leading-none text-slate-950">{value}</p>
          <p className="mt-2 text-[13px] text-slate-500">{detail}</p>
        </div>
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${selectedTone.icon}`}>
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
    <div className="flex flex-col justify-between gap-5 pb-1 pt-1 sm:flex-row sm:items-end">
      <div>
        <p className="inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50/80 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-blue-700 shadow-sm">
          <span className="size-1.5 rounded-full bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]" />
          {new Intl.DateTimeFormat("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          }).format(new Date())}
        </p>
        <h1 className="display-heading mt-3 text-[2rem] font-semibold leading-none tracking-[-0.045em] text-slate-950 sm:text-[2.5rem]">
          {copy.title}
        </h1>
        <p className="mt-2.5 max-w-2xl text-[15px] leading-6 text-slate-500">{copy.description}</p>
      </div>
      {actionLabel ? (
        <Button onClick={onAction} className="self-start rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 shadow-[0_10px_24px_-12px_rgba(37,99,235,0.9)] transition hover:-translate-y-0.5 sm:self-auto">
          <Plus className="size-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function Overview({ financial }: { financial: FinancialSummary }) {
  return (
    <div className="space-y-5">
      <PageIntro module="overview" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={BriefcaseBusiness} label="Trabalhos ativos" value="12" detail="8 projetos · 4 obras" />
        <KpiCard icon={CircleAlert} label="Precisam de você" value="6" detail="3 vencidos · 3 para hoje" tone="amber" />
        <KpiCard icon={Target} label="Propostas abertas" value={compactCurrency.format(540000)} detail="7 oportunidades" tone="slate" />
        <KpiCard icon={CircleDollarSign} label="A receber" value={compactCurrency.format(financial.receivables)} detail="próximos 30 dias" tone="emerald" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
        <Card>
          <CardHeading
            title="Prioridades de hoje"
            detail="Ordenadas por impacto, prazo e dependência"
            action={<Button variant="ghost" size="sm">Ver tarefas</Button>}
          />
          <div className="divide-y divide-slate-100">
            {focusTasks.map((task) => (
              <div key={task.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50/80">
                <button
                  aria-label={`Concluir ${task.title}`}
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-slate-300 text-transparent transition hover:border-blue-500 hover:text-blue-500"
                  onClick={() => toast.success("Tarefa concluída", { description: task.title })}
                >
                  <Check className="size-3" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                  <p className="mt-0.5 text-[13px] text-slate-500">{task.context} · {task.owner}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[13px] font-medium ${task.due.startsWith("Vencida") ? "text-red-600" : "text-slate-700"}`}>
                    {task.due}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{task.level}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden border-blue-400/15 bg-[radial-gradient(circle_at_95%_0%,rgba(65,126,255,0.38),transparent_45%),linear-gradient(145deg,#10284f_0%,#091a34_55%,#071323_100%)] text-white ring-blue-300/10">
          <div className="blueprint-grid relative h-full p-5 sm:p-6">
            <span className="absolute -right-10 -top-12 size-40 rounded-full border border-blue-300/15" />
            <span className="absolute -right-2 -top-4 size-24 rounded-full border border-blue-300/20" />
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-slate-300">
                  <Cloud className="size-4" />
                  Financeiro via Drap
                </div>
                <p className="metric-number display-heading mt-5 text-[2rem] font-semibold tracking-[-0.05em]">{currency.format(financial.currentBalance)}</p>
                <p className="mt-1 text-sm text-slate-300">Saldo consolidado</p>
              </div>
              <Badge className="border-white/10 bg-white/10 text-white hover:bg-white/10">
                {financial.source === "drap" ? "Sincronizado" : "Modo demonstração"}
              </Badge>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
              <div>
                <p className="text-xs text-slate-400">A pagar</p>
                <p className="metric-number mt-1 text-base font-medium">{currency.format(financial.payables)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Projeção 30 dias</p>
                <p className="metric-number mt-1 text-base font-medium">{currency.format(financial.projected30d)}</p>
              </div>
            </div>
            <button className="mt-6 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-medium text-blue-100 transition hover:border-white/20 hover:bg-white/10 hover:text-white">
              Abrir visão financeira <span aria-hidden="true">→</span>
            </button>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <ProjectTable limit={4} />
        <Card>
          <CardHeading title="Funil comercial" detail="R$ 672 mil em negociação" />
          <div className="space-y-4 p-5">
            {opportunities.map((item) => (
              <div key={item.stage}>
                <div className="mb-1.5 flex items-center justify-between gap-4 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.stage}
                  </span>
                  <span className="shrink-0 text-slate-500">{item.count} · {compactCurrency.format(item.value)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(18, item.value / 3000)}%`, backgroundColor: item.color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProjectTable({ limit, query = "" }: { limit?: number; query?: string }) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const rows = projects
    .filter((project) => !normalized || `${project.name} ${project.client} ${project.code} ${project.phase}`.toLocaleLowerCase("pt-BR").includes(normalized))
    .slice(0, limit);

  return (
    <Card className="overflow-hidden">
      <CardHeading
        title="Projetos e obras"
        detail={`${projects.length} trabalhos recentes`}
        action={<Button variant="ghost" size="sm">Ver todos</Button>}
      />
      <Table>
        <TableHeader>
          <TableRow className="bg-gradient-to-r from-blue-50/70 to-slate-50/50 hover:from-blue-50/70 hover:to-slate-50/50">
            <TableHead className="pl-5 text-xs text-slate-500">Trabalho</TableHead>
            <TableHead className="text-xs text-slate-500">Etapa</TableHead>
            <TableHead className="min-w-36 text-xs text-slate-500">Avanço</TableHead>
            <TableHead className="text-xs text-slate-500">Próximo marco</TableHead>
            <TableHead className="pr-5 text-right text-xs text-slate-500">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((project) => (
            <TableRow key={project.id} className="cursor-pointer transition-colors hover:bg-blue-50/45">
              <TableCell className="pl-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-600 text-xs font-semibold text-white shadow-[0_8px_18px_-10px_rgba(15,23,42,0.85)]">
                    {project.kind === "Obra" ? "OB" : "AR"}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{project.name}</p>
                    <p className="text-xs text-slate-500">{project.code} · {project.client}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-[13px] text-slate-600">{project.phase}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Progress value={project.progress} className="h-1.5 min-w-20 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
                  <span className="w-8 text-right text-xs tabular-nums text-slate-500">{project.progress}%</span>
                </div>
              </TableCell>
              <TableCell className="text-[13px] text-slate-600">{project.nextMilestone}</TableCell>
              <TableCell className="pr-5 text-right"><StatusBadge status={project.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Nenhum trabalho encontrado.</p> : null}
    </Card>
  );
}

function ProjectsView({ query, onAction }: { query: string; onAction: () => void }) {
  return (
    <div className="space-y-5">
      <PageIntro module="projects" actionLabel="Novo projeto" onAction={onAction} />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={FolderKanban} label="Em andamento" value="8" detail="3 entregas neste mês" />
        <KpiCard icon={Clock3} label="Horas previstas" value="426h" detail="318h já registradas" tone="slate" />
        <KpiCard icon={CircleDollarSign} label="Resultado projetado" value="R$ 184 mil" detail="margem média de 32%" tone="emerald" />
      </div>
      <ProjectTable query={query} />
    </div>
  );
}

function WorksView({ onAction }: { onAction: () => void }) {
  const works = projects.filter((project) => project.kind === "Obra");
  return (
    <div className="space-y-5">
      <PageIntro module="works" actionLabel="Nova obra" onAction={onAction} />
      <div className="grid gap-4 lg:grid-cols-2">
        {works.map((work) => (
          <Card key={work.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-wide text-blue-600">{work.code}</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{work.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{work.client} · Responsável: {work.owner}</p>
              </div>
              <StatusBadge status={work.status} />
            </div>
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-[13px]">
                <span className="font-medium text-slate-700">{work.phase}</span>
                <span className="tabular-nums text-slate-500">{work.progress}% concluído</span>
              </div>
              <Progress value={work.progress} className="h-2 bg-slate-100 [&_[data-slot=progress-indicator]]:bg-blue-600" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
              <div><p className="text-xs text-slate-400">Orçado</p><p className="mt-1 text-sm font-semibold">{compactCurrency.format(work.budget)}</p></div>
              <div><p className="text-xs text-slate-400">Realizado</p><p className="mt-1 text-sm font-semibold">{compactCurrency.format(work.spent)}</p></div>
              <div><p className="text-xs text-slate-400">Registros</p><p className="mt-1 text-sm font-semibold">24 no diário</p></div>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeading title="Pendências de campo" detail="Somente itens que podem afetar prazo ou custo" />
        <div className="grid gap-0 divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
          {[
            ["Medição aguardando aprovação", "Clínica Átrio", "R$ 24.800"],
            ["Compra sem fornecedor definido", "Casa Cedro", "Marcenaria complementar"],
            ["Diário sem assinatura", "Clínica Átrio", "Registro de 04 set"],
          ].map(([title, context, detail]) => (
            <div key={title} className="p-5">
              <CircleAlert className="size-5 text-amber-600" />
              <p className="mt-3 text-sm font-medium text-slate-900">{title}</p>
              <p className="mt-1 text-[13px] text-slate-500">{context} · {detail}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function BudgetsView({ onAction }: { onAction: () => void }) {
  return (
    <div className="space-y-5">
      <PageIntro module="budgets" actionLabel="Novo orçamento" onAction={onAction} />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={Calculator} label="Em negociação" value="R$ 238 mil" detail="2 propostas com cliente" />
        <KpiCard icon={CircleDollarSign} label="Margem média" value="31,3%" detail="meta mínima: 28%" tone="emerald" />
        <KpiCard icon={CheckCircle2} label="Conversão" value="42%" detail="últimos 90 dias" tone="slate" />
      </div>
      <Card className="overflow-hidden">
        <CardHeading title="Orçamentos recentes" detail="Cada revisão preserva sua versão anterior" />
        <Table>
          <TableHeader>
            <TableRow className="bg-gradient-to-r from-blue-50/70 to-slate-50/50 hover:from-blue-50/70 hover:to-slate-50/50">
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

function CrmView({ onAction }: { onAction: () => void }) {
  const stages = opportunities.map((item) => item.stage);
  return (
    <div className="space-y-5">
      <PageIntro module="crm" actionLabel="Nova oportunidade" onAction={onAction} />
      <div className="grid min-w-0 gap-4 overflow-x-auto pb-2 lg:grid-cols-4">
        {stages.map((stage) => {
          const cards = crmCards.filter((card) => card.stage === stage);
          const total = cards.reduce((sum, card) => sum + card.value, 0);
          return (
            <section key={stage} className="min-w-[270px] rounded-[1.25rem] border border-white/80 bg-slate-200/45 p-3.5 shadow-inner ring-1 ring-slate-900/[0.03] lg:min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3 px-1"><div><h2 className="text-sm font-semibold text-slate-800">{stage}</h2><p className="text-xs text-slate-500">{cards.length} · {compactCurrency.format(total)}</p></div><Button variant="ghost" size="icon-xs" aria-label={`Adicionar em ${stage}`}><Plus /></Button></div>
              <div className="space-y-2.5">
                {cards.map((card) => (
                  <article key={card.id} className="rounded-xl border border-white bg-white/95 p-4 shadow-[0_14px_30px_-24px_rgba(15,36,67,0.5)] ring-1 ring-slate-900/[0.04] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-22px_rgba(37,99,235,0.35)]">
                    <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium leading-5 text-slate-900">{card.name}</p><Button variant="ghost" size="icon-xs" aria-label="Mais ações"><MoreHorizontal /></Button></div>
                    <p className="mt-1 text-xs text-slate-500">{card.client}</p>
                    <p className="metric-number mt-4 text-base font-semibold text-slate-900">{currency.format(card.value)}</p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Clock3 className="size-3.5" />{card.next}</p>
                  </article>
                ))}
                {cards.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500">Nenhuma oportunidade</div> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TeamView({ onAction }: { onAction: () => void }) {
  return (
    <div className="space-y-5">
      <PageIntro module="team" actionLabel="Convidar pessoa" onAction={onAction} />
      <div className="grid gap-3 sm:grid-cols-3"><KpiCard icon={Users} label="Equipe ativa" value="9" detail="7 internos · 2 parceiros" /><KpiCard icon={Clock3} label="Capacidade semanal" value="91%" detail="327h de 360h" tone="amber" /><KpiCard icon={ShieldCheck} label="Acessos" value="Todos revisados" detail="última revisão em 28 ago" tone="emerald" /></div>
      <Card>
        <CardHeading title="Carga desta semana" detail="Horas comprometidas x capacidade disponível" />
        <div className="grid gap-4 p-5 md:grid-cols-2">
          {team.map((member) => (
            <div key={member.name} className="rounded-xl border border-slate-200/70 bg-gradient-to-br from-white to-slate-50/70 p-4 shadow-[0_12px_28px_-24px_rgba(15,36,67,0.5)]">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-semibold text-white shadow-lg ring-2 ring-blue-100">{member.initials}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-900">{member.name}</p><p className="text-xs text-slate-500">{member.role}</p></div><span className={`text-sm font-semibold tabular-nums ${member.load > 100 ? "text-red-600" : "text-slate-700"}`}>{member.load}%</span></div>
              <Progress value={Math.min(member.load, 100)} className={`mt-4 h-1.5 bg-slate-100 ${member.load > 100 ? "[&_[data-slot=progress-indicator]]:bg-red-500" : "[&_[data-slot=progress-indicator]]:bg-blue-600"}`} />
              <p className="mt-2 text-xs text-slate-500">{member.hours}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function TasksView({ onAction }: { onAction: () => void }) {
  return (
    <div className="space-y-5">
      <PageIntro module="tasks" actionLabel="Nova tarefa" onAction={onAction} />
      <div className="grid gap-3 sm:grid-cols-4"><KpiCard icon={CircleAlert} label="Vencidas" value="3" detail="2 bloqueiam entregas" tone="amber" /><KpiCard icon={Clock3} label="Para hoje" value="6" detail="4 atribuídas a você" /><KpiCard icon={CalendarRange} label="Esta semana" value="18" detail="em 7 trabalhos" tone="slate" /><KpiCard icon={CheckCircle2} label="Concluídas" value="27" detail="nos últimos 7 dias" tone="emerald" /></div>
      <Card>
        <CardHeading title="Fila de execução" detail="A prioridade é calculada pelo impacto no trabalho" />
        <div className="divide-y divide-slate-100">
          {[...focusTasks, { id: "tsk_5", title: "Revisar paginação do caderno", context: "Apartamento Lume", due: "Amanhã, 11:00", level: "Normal", owner: "Lívia" }].map((task) => (
            <div key={task.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
              <button aria-label={`Concluir ${task.title}`} className="grid size-5 shrink-0 place-items-center rounded-full border border-slate-300 text-transparent hover:border-blue-500 hover:text-blue-500" onClick={() => toast.success("Tarefa concluída", { description: task.title })}><Check className="size-3" /></button>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-900">{task.title}</p><p className="mt-0.5 text-xs text-slate-500">{task.context}</p></div>
              <Badge variant="outline" className="self-start sm:self-auto">{task.owner}</Badge>
              <div className="w-36 text-left sm:text-right"><p className={`text-[13px] font-medium ${task.due.startsWith("Vencida") ? "text-red-600" : "text-slate-700"}`}>{task.due}</p><p className="text-xs text-slate-400">{task.level}</p></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function FilesView({ onAction }: { onAction: () => void }) {
  return (
    <div className="space-y-5">
      <PageIntro module="files" actionLabel="Enviar arquivo" onAction={onAction} />
      <div className="grid gap-3 sm:grid-cols-3">
        {[{ label: "Projetos", count: "184 arquivos", icon: FolderKanban }, { label: "Obras", count: "362 arquivos", icon: Building2 }, { label: "Modelos do escritório", count: "28 arquivos", icon: Archive }].map((folder) => (
          <Card key={folder.label} className="flex cursor-pointer items-center gap-3 p-4 hover:border-blue-300"><span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[0_10px_22px_-12px_rgba(37,99,235,0.9)]"><folder.icon className="size-5" /></span><div><p className="text-sm font-semibold text-slate-900">{folder.label}</p><p className="mt-0.5 text-xs text-slate-500">{folder.count}</p></div></Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        <CardHeading title="Atualizados recentemente" detail="Revisões mais novas primeiro" />
        <Table>
          <TableHeader><TableRow className="bg-gradient-to-r from-blue-50/70 to-slate-50/50 hover:from-blue-50/70 hover:to-slate-50/50"><TableHead className="pl-5 text-xs text-slate-500">Arquivo</TableHead><TableHead className="text-xs text-slate-500">Trabalho</TableHead><TableHead className="text-xs text-slate-500">Tamanho</TableHead><TableHead className="text-xs text-slate-500">Responsável</TableHead><TableHead className="pr-5 text-right text-xs text-slate-500">Atualização</TableHead></TableRow></TableHeader>
          <TableBody>{files.map((file) => <TableRow key={file.name} className="transition-colors hover:bg-blue-50/45"><TableCell className="pl-5"><div className="flex items-center gap-2.5"><span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100"><Paperclip className="size-4" /></span><div><p className="text-sm font-medium text-slate-900">{file.name}</p><p className="text-xs text-slate-500">{file.type}</p></div></div></TableCell><TableCell className="text-[13px] text-slate-600">{file.project}</TableCell><TableCell className="text-[13px] text-slate-500">{file.size}</TableCell><TableCell className="text-[13px] text-slate-600">{file.author}</TableCell><TableCell className="pr-5 text-right text-[13px] text-slate-500">{file.updatedAt}</TableCell></TableRow>)}</TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ScheduleView() {
  return (
    <div className="space-y-5">
      <PageIntro module="schedule" />
      <Card className="overflow-hidden">
        <CardHeading title="Planejamento integrado" detail="6 semanas · 01 set a 12 out" action={<Button variant="outline" size="sm">Hoje</Button>} />
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[210px_1fr] border-b border-slate-200 bg-gradient-to-r from-blue-50/70 to-slate-50/50">
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

function QuickCreate({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const actions = [
    { label: "Projeto", detail: "Cliente, escopo e etapas", icon: FolderKanban },
    { label: "Oportunidade", detail: "Contato e próximo passo", icon: Target },
    { label: "Orçamento", detail: "Composição, BDI e margem", icon: Calculator },
    { label: "Tarefa", detail: "Responsável, prazo e vínculo", icon: ListChecks },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Criar</DialogTitle><DialogDescription>Escolha o que precisa registrar agora.</DialogDescription></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {actions.map((action) => (
            <button key={action.label} className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-gradient-to-br from-white to-slate-50/60 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md" onClick={() => { onOpenChange(false); toast.success(`${action.label} iniciado`, { description: "O fluxo já está preparado para conexão com o banco de dados." }); }}>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg"><action.icon className="size-[18px]" /></span>
              <span><span className="block text-sm font-semibold text-slate-900">{action.label}</span><span className="mt-0.5 block text-xs text-slate-500">{action.detail}</span></span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NexoApp() {
  const [activeModule, setActiveModule] = useState<ModuleId>("overview");
  const [query, setQuery] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [financial, setFinancial] = useState<FinancialSummary>(demoFinancialSummary);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations/drap/summary", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Finance unavailable"))))
      .then((data: FinancialSummary) => setFinancial(data))
      .catch((error: Error) => {
        if (error.name !== "AbortError") setFinancial(demoFinancialSummary);
      });
    return () => controller.abort();
  }, []);

  const activeLabel = useMemo(() => moduleTitles[activeModule].title, [activeModule]);

  const content = (() => {
    switch (activeModule) {
      case "overview": return <Overview financial={financial} />;
      case "projects": return <ProjectsView query={query} onAction={() => setQuickOpen(true)} />;
      case "works": return <WorksView onAction={() => setQuickOpen(true)} />;
      case "budgets": return <BudgetsView onAction={() => setQuickOpen(true)} />;
      case "schedule": return <ScheduleView />;
      case "crm": return <CrmView onAction={() => setQuickOpen(true)} />;
      case "finance": return <FinanceView financial={financial} />;
      case "team": return <TeamView onAction={() => setQuickOpen(true)} />;
      case "tasks": return <TasksView onAction={() => setQuickOpen(true)} />;
      case "files": return <FilesView onAction={() => setQuickOpen(true)} />;
    }
  })();

  return (
    <SidebarProvider className="nexo-shell" style={{ "--sidebar-width": "17rem" } as React.CSSProperties}>
      <Sidebar collapsible="icon" className="nexo-sidebar border-r-0">
        <SidebarHeader className="p-3.5">
          <button className="flex h-14 items-center gap-3 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.035] px-2.5 text-left transition hover:border-white/10 hover:bg-white/[0.07]" aria-label="Selecionar empresa">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-400 via-blue-500 to-blue-700 text-sm font-bold text-white shadow-[0_10px_24px_-12px_rgba(62,124,255,0.95)] ring-1 ring-white/20">N</span>
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><span className="block truncate text-sm font-semibold text-white">Nexo Obra</span><span className="block truncate text-xs text-slate-400">Ateliê Norte Arquitetura</span></span>
            <ChevronDown className="size-4 shrink-0 text-slate-500 group-data-[collapsible=icon]:hidden" />
          </button>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent className="px-1 py-2">
          {navSections.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton tooltip={item.label} isActive={activeModule === item.id} onClick={() => setActiveModule(item.id)} className="h-10 rounded-lg text-slate-300 transition data-[active=true]:bg-gradient-to-r data-[active=true]:from-blue-600 data-[active=true]:to-blue-500 data-[active=true]:text-white data-[active=true]:shadow-[0_9px_22px_-12px_rgba(55,111,245,0.95)] hover:bg-white/[0.07] hover:text-white">
                        <item.icon /><span>{item.label}</span>
                      </SidebarMenuButton>
                      {item.badge ? <SidebarMenuBadge className={activeModule === item.id ? "text-white" : "text-slate-400"}>{item.badge}</SidebarMenuBadge> : null}
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
            <SidebarMenuItem><SidebarMenuButton tooltip="Configurações" className="text-slate-300 hover:text-white"><Settings2 /><span>Configurações</span></SidebarMenuButton></SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Conta" className="mt-1 rounded-xl text-slate-300 hover:bg-white/[0.06] hover:text-white"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-xs font-semibold text-white shadow-lg ring-2 ring-white/10">MA</span><span className="min-w-0"><span className="block truncate text-sm font-medium text-white">Marina Alves</span><span className="block truncate text-xs text-slate-400">Administradora</span></span></SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="nexo-header sticky top-0 z-20 flex h-[4.5rem] items-center gap-3 border-b border-white/80 px-4 backdrop-blur-xl sm:px-6">
          <SidebarTrigger className="size-10 rounded-xl border border-slate-200/80 bg-white/80 shadow-sm" />
          <div className="hidden h-5 w-px bg-slate-200 sm:block" />
          <p className="hidden items-center gap-2 text-sm font-semibold text-slate-700 sm:flex"><span className="size-1.5 rounded-full bg-blue-500" />{activeLabel}</p>
          <div className="mx-auto w-full max-w-md sm:ml-auto sm:mr-0">
            <div className="relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar projetos, clientes, tarefas..." aria-label="Buscar" className="h-10 rounded-xl border-white bg-white/75 pl-10 shadow-[0_8px_22px_-18px_rgba(15,36,67,0.55)] ring-1 ring-slate-200/70 transition focus-visible:bg-white" /></div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Notificações" className="relative"><Bell className="size-[18px]" /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-red-500" /></Button>
          <Button size="sm" onClick={() => setQuickOpen(true)} className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 shadow-[0_10px_22px_-12px_rgba(37,99,235,0.85)]"><Plus className="size-4" /><span className="hidden sm:inline">Criar</span></Button>
        </header>

        <main className="nexo-canvas blueprint-grid min-h-[calc(100svh-4.5rem)] p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-[1480px]">{content}</div>
        </main>
      </SidebarInset>
      <QuickCreate open={quickOpen} onOpenChange={setQuickOpen} />
      <Toaster position="bottom-right" />
    </SidebarProvider>
  );
}
