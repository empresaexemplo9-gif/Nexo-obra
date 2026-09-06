"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpenText,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileStack,
  FolderOpen,
  HardHat,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PermissionModule, PermissionSet } from "@/lib/permissions";

type SessionData = {
  authenticated: boolean;
  signInPath?: string;
  member?: { permissions: PermissionSet };
  terms?: { accepted: boolean };
  organization?: { name: string };
};

type Project = {
  id: string;
  clientName: string | null;
  code: string;
  name: string;
  kind: "project" | "work";
  status: string;
  phase: string;
  progressPercent: number;
  ownerName: string | null;
  startDate: string | null;
  targetDate: string | null;
  budgetCents: number | null;
  externalFinancialCostCenterId: string | null;
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigneeName: string | null;
  dueAt: string | null;
};

type FinancialSummary = {
  currentBalance: number;
  receivables: number;
  payables: number;
  projected30d: number;
  overdueReceivables: number;
};

type HubState = {
  session: SessionData | null;
  project: Project | null;
  tasks: Task[];
  financial: FinancialSummary | null;
  financialMessage: string;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

const statusLabels: Record<string, string> = {
  active: "Em andamento",
  on_hold: "Pausado",
  completed: "Concluído",
  archived: "Arquivado",
  todo: "A fazer",
  in_progress: "Em execução",
  blocked: "Bloqueada",
  done: "Concluída",
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os dados.");
  return body;
}

function formatDate(value: string | null) {
  return value ? shortDate.format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "Não informado";
}

function can(session: SessionData | null, module: PermissionModule) {
  return Boolean(session?.member?.permissions[module].view);
}

function StateBadge({ status }: { status: string }) {
  const positive = status === "completed" || status === "done";
  const warning = status === "blocked" || status === "on_hold";
  return (
    <Badge variant="outline" className={positive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : warning ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700"}>
      {statusLabels[status] ?? status}
    </Badge>
  );
}

function MetricCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Clock3 }) {
  return (
    <Card className="workspace-card border-white/80 bg-white/90">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="metric-number mt-3 text-2xl font-semibold text-slate-950">{value}</p><p className="mt-2 text-xs text-slate-500">{note}</p></div>
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Icon className="size-5" /></span>
        </div>
      </CardContent>
    </Card>
  );
}

function ModuleCard({ title, description, status, icon: Icon, allowed = true }: { title: string; description: string; status: "Ativo" | "Próxima conexão" | "Restrito"; icon: typeof Clock3; allowed?: boolean }) {
  const effectiveStatus = allowed ? status : "Restrito";
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-700">{allowed ? <Icon className="size-5" /> : <LockKeyhole className="size-4" />}</span>
        <Badge variant="outline" className={effectiveStatus === "Ativo" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : effectiveStatus === "Restrito" ? "border-slate-200 bg-slate-50 text-slate-500" : "border-blue-200 bg-blue-50 text-blue-700"}>{effectiveStatus}</Badge>
      </div>
      <p className="mt-4 font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{allowed ? description : "Seu perfil não pode visualizar esta área."}</p>
    </div>
  );
}

function LoadingHub() {
  return <main className="grid min-h-svh place-items-center bg-[#071426]"><div className="flex flex-col items-center gap-5"><Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-[220px]" /><LoaderCircle className="size-6 animate-spin text-cyan-400" /><p className="text-sm text-slate-400">Organizando a central da obra…</p></div></main>;
}

export function ProjectHub({ projectId }: { projectId: string }) {
  const [state, setState] = useState<HubState>({ session: null, project: null, tasks: [], financial: null, financialMessage: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await readJson<SessionData>("/api/session");
      if (!session.authenticated || !session.terms?.accepted || !can(session, "projects")) {
        setState((current) => ({ ...current, session }));
        return;
      }
      const projectRequest = readJson<{ project: Project }>(`/api/projects/${projectId}`);
      const taskRequest = can(session, "tasks")
        ? readJson<{ tasks: Task[] }>(`/api/tasks?projectId=${encodeURIComponent(projectId)}`).then((value) => value.tasks)
        : Promise.resolve([] as Task[]);
      const financialRequest = can(session, "finance")
        ? readJson<FinancialSummary>("/api/integrations/drap/summary")
          .then((value) => ({ value, message: "" }))
          .catch((cause: Error) => ({ value: null, message: cause.message }))
        : Promise.resolve({ value: null, message: "" });
      const [projectResult, tasks, financialResult] = await Promise.all([projectRequest, taskRequest, financialRequest]);
      setState({ session, project: projectResult.project, tasks, financial: financialResult.value, financialMessage: financialResult.message });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir esta central.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openTasks = useMemo(() => state.tasks.filter((task) => task.status !== "done"), [state.tasks]);
  const finishedTasks = state.tasks.length - openTasks.length;
  const session = state.session;
  const project = state.project;

  if (loading) return <LoadingHub />;
  if (!session?.authenticated) return <main className="grid min-h-svh place-items-center bg-slate-950 p-5"><Card className="w-full max-w-md border-white/10 bg-slate-900 text-white"><CardContent className="p-8 text-center"><ShieldCheck className="mx-auto size-10 text-cyan-300" /><h1 className="mt-5 text-2xl font-semibold">Entre para abrir esta central</h1><p className="mt-3 text-sm leading-6 text-slate-300">O projeto permanece protegido dentro da empresa responsável.</p><Button asChild className="mt-6 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300"><a href={session?.signInPath ?? "/"}>Acessar conta</a></Button></CardContent></Card></main>;
  if (!session.terms?.accepted) return <main className="grid min-h-svh place-items-center p-5"><Card className="max-w-md"><CardContent className="p-8 text-center"><ClipboardCheck className="mx-auto size-10 text-blue-600" /><h1 className="mt-5 text-2xl font-semibold">Aceite necessário</h1><p className="mt-3 text-sm text-slate-500">Confirme os Termos de Uso na página inicial antes de abrir dados da empresa.</p><Button asChild className="mt-6"><Link href="/">Voltar para o início</Link></Button></CardContent></Card></main>;
  if (!can(session, "projects")) return <main className="grid min-h-svh place-items-center p-5"><Card className="max-w-md"><CardContent className="p-8 text-center"><LockKeyhole className="mx-auto size-10 text-slate-500" /><h1 className="mt-5 text-2xl font-semibold">Área não liberada</h1><p className="mt-3 text-sm text-slate-500">O administrador da empresa não liberou projetos e obras para este acesso.</p><Button asChild variant="outline" className="mt-6"><Link href="/">Voltar</Link></Button></CardContent></Card></main>;
  if (error || !project) return <main className="grid min-h-svh place-items-center p-5"><Card className="max-w-md"><CardContent className="p-8 text-center"><TriangleAlert className="mx-auto size-10 text-amber-500" /><h1 className="mt-5 text-2xl font-semibold">Central indisponível</h1><p className="mt-3 text-sm text-slate-500">{error || "Este projeto não foi encontrado na empresa atual."}</p><div className="mt-6 flex justify-center gap-3"><Button variant="outline" asChild><Link href="/">Voltar</Link></Button><Button onClick={() => void load()}>Tentar novamente</Button></div></CardContent></Card></main>;

  const budgetAllowed = can(session, "budgets");
  const tasksAllowed = can(session, "tasks");
  const financeAllowed = can(session, "finance");

  return (
    <main className="min-h-svh bg-[#edf2f8]">
      <header className="border-b border-white/10 bg-[#08172c] text-white shadow-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="Voltar para a plataforma" className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-slate-300 transition hover:bg-white/10 hover:text-white"><ArrowLeft className="size-4" /></Link>
          <Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-[150px] sm:w-[190px]" />
          <div className="ml-auto min-w-0 text-right"><p className="truncate text-sm font-medium text-white">{session.organization?.name}</p><p className="text-xs text-slate-400">Central da obra</p></div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[#0b1c37] px-4 pb-20 pt-10 text-white sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_8%,rgba(24,88,232,0.42),transparent_35rem),radial-gradient(circle_at_15%_120%,rgba(12,196,207,0.2),transparent_28rem)]" />
        <div className="relative mx-auto max-w-[1500px]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2"><Badge className="border-cyan-300/20 bg-cyan-300/10 text-cyan-100">{project.kind === "work" ? <HardHat /> : <BriefcaseBusiness />}{project.kind === "work" ? "Obra" : "Projeto"}</Badge><StateBadge status={project.status} /><span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{project.code}</span></div>
              <h1 className="display-heading mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">{project.name}</h1>
              <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300"><span className="flex items-center gap-2"><Building2 className="size-4 text-cyan-300" />{project.clientName ?? "Cliente não informado ou não liberado"}</span><span className="flex items-center gap-2"><UserRound className="size-4 text-cyan-300" />{project.ownerName ?? "Responsável não definido"}</span></p>
            </div>
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur"><div className="flex items-end justify-between"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Avanço informado</p><p className="metric-number mt-2 text-4xl font-semibold">{project.progressPercent}%</p></div><TargetMark value={project.progressPercent} /></div><Progress value={project.progressPercent} className="mt-5 h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-cyan-400" /></div>
          </div>
        </div>
      </section>

      <div className="relative mx-auto -mt-10 max-w-[1500px] px-4 pb-14 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Fase atual" value={project.phase} note="Etapa registrada no projeto" icon={Boxes} />
          <MetricCard label="Prazo" value={formatDate(project.targetDate)} note={project.startDate ? `Início em ${formatDate(project.startDate)}` : "Data inicial não informada"} icon={CalendarDays} />
          <MetricCard label="Tarefas abertas" value={tasksAllowed ? String(openTasks.length) : "Restrito"} note={tasksAllowed ? `${finishedTasks} concluída(s)` : "Permissão definida pelo administrador"} icon={ListChecks} />
          <MetricCard label="Orçamento-base" value={budgetAllowed && project.budgetCents !== null ? currency.format(project.budgetCents / 100) : "Restrito"} note={budgetAllowed ? "Valor registrado no projeto" : "Permissão definida pelo administrador"} icon={CircleDollarSign} />
        </div>

        <Tabs defaultValue="resumo" className="mt-8">
          <TabsList variant="line" className="scrollbar-none h-auto w-full justify-start gap-5 overflow-x-auto border-b border-slate-200 bg-transparent px-1">
            <TabsTrigger value="resumo" className="px-1 pb-3">Resumo</TabsTrigger>
            <TabsTrigger value="planejamento" className="px-1 pb-3">Planejamento</TabsTrigger>
            <TabsTrigger value="custos" className="px-1 pb-3">Custos e financeiro</TabsTrigger>
            <TabsTrigger value="registros" className="px-1 pb-3">Registros</TabsTrigger>
          </TabsList>

          <TabsContent value="resumo" className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
            <Card className="workspace-card border-white/80"><CardHeader><CardTitle className="flex items-center gap-2"><FolderOpen className="size-5 text-blue-600" />Ciclo desta obra</CardTitle><p className="text-sm leading-6 text-slate-500">Um único ponto para acompanhar planejamento, execução, custos e registros.</p></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><ModuleCard title="Planejamento" description="Datas e tarefas do projeto." status="Ativo" icon={CalendarDays} allowed={can(session, "schedule")} /><ModuleCard title="Tarefas" description={`${state.tasks.length} tarefa(s) vinculada(s).`} status="Ativo" icon={ListChecks} allowed={tasksAllowed} /><ModuleCard title="Orçamento" description="Valor-base e versões do orçamento." status="Ativo" icon={ReceiptText} allowed={budgetAllowed} /><ModuleCard title="Financeiro" description="Integração oficial da empresa." status={state.financial ? "Ativo" : "Próxima conexão"} icon={WalletCards} allowed={financeAllowed} /><ModuleCard title="Diário de obra" description="Fotos, ocorrências e relatórios." status="Próxima conexão" icon={BookOpenText} /><ModuleCard title="Arquivos" description="Documentos vinculados ao trabalho." status="Próxima conexão" icon={FileStack} allowed={can(session, "files")} /></div></CardContent></Card>
            <Card className="workspace-card border-white/80"><CardHeader><CardTitle className="text-base">Ficha do trabalho</CardTitle></CardHeader><CardContent className="space-y-4 text-sm"><InfoRow label="Código" value={project.code} /><InfoRow label="Tipo" value={project.kind === "work" ? "Obra" : "Projeto"} /><InfoRow label="Situação" value={statusLabels[project.status] ?? project.status} /><InfoRow label="Fase" value={project.phase} /><InfoRow label="Responsável" value={project.ownerName ?? "Não definido"} /><InfoRow label="Início" value={formatDate(project.startDate)} /><InfoRow label="Prazo" value={formatDate(project.targetDate)} /></CardContent></Card>
          </TabsContent>

          <TabsContent value="planejamento" className="mt-6 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
            <Card className="workspace-card border-white/80"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="size-5 text-blue-600" />Janela planejada</CardTitle></CardHeader><CardContent><div className="relative space-y-7 pl-8 before:absolute before:bottom-3 before:left-[0.7rem] before:top-3 before:w-px before:bg-slate-200"><TimelinePoint title="Início" value={formatDate(project.startDate)} active /><TimelinePoint title="Fase atual" value={project.phase} active /><TimelinePoint title="Entrega prevista" value={formatDate(project.targetDate)} /></div></CardContent></Card>
            <Card className="workspace-card border-white/80"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ListChecks className="size-5 text-blue-600" />Tarefas vinculadas</CardTitle><p className="text-sm text-slate-500">Execução real organizada por prioridade, responsável e prazo.</p></CardHeader><CardContent>{tasksAllowed ? state.tasks.length ? <div className="space-y-3">{state.tasks.slice(0, 8).map((task) => <div key={task.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:items-center"><span className="grid size-9 place-items-center rounded-xl bg-white text-blue-600 shadow-sm">{task.status === "done" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Clock3 className="size-4" />}</span><div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-900">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.assigneeName ?? "Sem responsável"} · {task.dueAt ? formatDate(task.dueAt) : "Sem prazo"}</p></div><StateBadge status={task.status} /></div>)}</div> : <HonestMessage icon={ListChecks} title="Nenhuma tarefa vinculada" description="Cadastre as tarefas na plataforma para acompanhar a execução aqui." /> : <HonestMessage icon={LockKeyhole} title="Tarefas restritas" description="O administrador da empresa não liberou esta área para o seu acesso." />}</CardContent></Card>
          </TabsContent>

          <TabsContent value="custos" className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card className="workspace-card border-white/80"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ReceiptText className="size-5 text-blue-600" />Orçamento do projeto</CardTitle></CardHeader><CardContent>{budgetAllowed ? <><p className="metric-number text-4xl font-semibold text-slate-950">{project.budgetCents !== null ? currency.format(project.budgetCents / 100) : "Não informado"}</p><p className="mt-3 text-sm leading-6 text-slate-500">Valor-base cadastrado. As composições e versões detalhadas já podem ser administradas no módulo Orçamentos.</p><Button asChild variant="outline" className="mt-5"><Link href="/?module=budgets">Abrir orçamentos</Link></Button></> : <HonestMessage icon={LockKeyhole} title="Orçamento restrito" description="Seu nível de acesso não permite visualizar valores desta obra." />}</CardContent></Card>
            <Card className="workspace-card border-white/80"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><WalletCards className="size-5 text-blue-600" />Financeiro da empresa</CardTitle><p className="text-xs leading-5 text-slate-500">Estes valores são da empresa inteira, não desta obra isoladamente.</p></CardHeader><CardContent>{!financeAllowed ? <HonestMessage icon={LockKeyhole} title="Financeiro restrito" description="Seu nível de acesso não permite visualizar dados financeiros." /> : state.financial ? <div className="grid grid-cols-2 gap-3"><FinancialValue label="Saldo atual" value={state.financial.currentBalance} /><FinancialValue label="A receber" value={state.financial.receivables} /><FinancialValue label="A pagar" value={state.financial.payables} /><FinancialValue label="Projeção 30 dias" value={state.financial.projected30d} /></div> : <HonestMessage icon={CircleDollarSign} title="Integração financeira pendente" description={state.financialMessage || "Conecte a fonte financeira oficial da empresa para consultar os valores."} />}{financeAllowed ? <p className="mt-4 text-xs text-slate-500">Centro de custo desta obra: {project.externalFinancialCostCenterId ? "vinculado" : "ainda não vinculado"}.</p> : null}</CardContent></Card>
          </TabsContent>

          <TabsContent value="registros" className="mt-6">
            <Card className="workspace-card border-white/80"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="size-5 text-blue-600" />Registros operacionais</CardTitle><p className="text-sm leading-6 text-slate-500">A central já reserva o lugar de cada fluxo. Os módulos abaixo serão ativados sem inserir dados demonstrativos.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><ModuleCard title="Diário de obra" description="Fotos, clima, equipe e ocorrências." status="Próxima conexão" icon={BookOpenText} /><ModuleCard title="Compras" description="Cotações, pedidos e fornecedores." status="Próxima conexão" icon={Boxes} /><ModuleCard title="Medições" description="Evolução física e aprovações." status="Próxima conexão" icon={ClipboardCheck} /><ModuleCard title="Arquivos" description="Projetos, contratos e comprovantes." status="Próxima conexão" icon={FileStack} allowed={can(session, "files")} /></CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function TargetMark({ value }: { value: number }) {
  return <span className="grid size-12 place-items-center rounded-full border border-cyan-300/20 bg-cyan-300/10"><span className="size-3 rounded-full bg-cyan-300 shadow-[0_0_0_6px_rgba(103,232,249,0.12)]" style={{ opacity: Math.max(0.35, value / 100) }} /></span>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-5 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="text-slate-500">{label}</span><span className="text-right font-medium text-slate-900">{value}</span></div>;
}

function TimelinePoint({ title, value, active = false }: { title: string; value: string; active?: boolean }) {
  return <div className="relative"><span className={`absolute -left-8 top-1 grid size-6 place-items-center rounded-full border-4 border-white ${active ? "bg-blue-600" : "bg-slate-300"}`} /><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p><p className="mt-1 font-medium text-slate-900">{value}</p></div>;
}

function HonestMessage({ icon: Icon, title, description }: { icon: typeof Clock3; title: string; description: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center"><Icon className="mx-auto size-8 text-slate-400" /><p className="mt-4 font-medium text-slate-800">{title}</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p></div>;
}

function FinancialValue({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="metric-number mt-2 text-lg font-semibold text-slate-900">{currency.format(value)}</p></div>;
}
