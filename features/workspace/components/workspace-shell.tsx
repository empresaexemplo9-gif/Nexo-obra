'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
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
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { initialProjects, moduleCopy, navigation, priorities } from '../data/demo';
import type { Project, ViewId } from '../types';

type WebMcpContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => unknown;
  }, options: { signal: AbortSignal }) => void | Promise<void>;
};

const healthStyle = {
  'No prazo': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Atenção: 'bg-amber-50 text-amber-800 ring-amber-200',
  Atrasado: 'bg-red-50 text-red-700 ring-red-200',
};

export function WorkspaceShell() {
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const activeLabel = navigation.find((item) => item.id === activeView)?.label ?? 'Visão geral';
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return projects;
    return projects.filter((project) =>
      [project.name, project.client, project.type, project.stage]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(normalized),
    );
  }, [projects, query]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(context.registerTool({
      name: 'list_projects',
      title: 'Listar projetos',
      description: 'Lista os projetos visíveis no escritório com etapa, avanço, prazo e situação.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({ projects: projects.map(({ id, name, client, stage, progress, deadline, health }) => ({ id, name, client, stage, progress, deadline, health })) }),
    }, { signal: lifecycle.signal })).catch(() => undefined);

    void Promise.resolve(context.registerTool({
      name: 'start_project_creation',
      title: 'Iniciar novo projeto',
      description: 'Abre o mesmo formulário de criação de projeto disponível na interface.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        setDialogOpen(true);
        return { status: 'ready', next: 'Preencha nome, cliente e tipo do projeto.' };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);

    return () => lifecycle.abort();
  }, [projects]);

  function navigate(view: ViewId) {
    setActiveView(view);
    setNotice('');
  }

  function addProject(formData: FormData) {
    const rawName = formData.get('name');
    const rawClient = formData.get('client');
    const rawType = formData.get('type');
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const client = typeof rawClient === 'string' ? rawClient.trim() : '';
    if (!name || !client) return;
    const project: Project = {
      id: `p-${Date.now()}`,
      name,
      client,
      type: typeof rawType === 'string' ? rawType : 'Arquitetura',
      stage: 'Briefing',
      progress: 5,
      deadline: 'A definir',
      health: 'No prazo',
    };
    setProjects((current) => [project, ...current]);
    setDialogOpen(false);
    setActiveView('projects');
    setNotice(`${name} foi criado e já está pronto para receber tarefas.`);
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r-0">
        <SidebarHeader className="px-3 py-4">
          <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => navigate('overview')}>
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <Building2 size={19} />
            </span>
            <span className="min-w-0 group-data-[collapsible=icon]:hidden">
              <strong className="block truncate text-[15px] tracking-[-0.02em]">Nexo Obra</strong>
              <small className="block truncate text-xs text-sidebar-foreground/55">Ateliê Norte Arquitetura</small>
            </span>
          </button>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Operação</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigation.map(({ id, label, icon: Icon, badge }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      tooltip={label}
                      isActive={activeView === id}
                      onClick={() => navigate(id)}
                      className="h-10"
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <button className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-sidebar-accent">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#d7e4ff] text-xs font-bold text-[#254b96]">MA</span>
            <span className="min-w-0 group-data-[collapsible=icon]:hidden">
              <strong className="block truncate text-sm">Marina Alves</strong>
              <small className="block truncate text-xs text-sidebar-foreground/55">Administradora</small>
            </span>
            <ChevronDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
          </button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/92 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <SidebarTrigger className="md:hidden" />
          <div className="relative hidden w-full max-w-md sm:block">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar em todo o escritório"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar projeto, cliente ou tarefa"
              className="h-9 border-transparent bg-muted pl-9 shadow-none focus-visible:bg-card"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Notificações"><Bell /></Button>
            <Button size="lg" onClick={() => setDialogOpen(true)}><Plus /> Criar</Button>
          </div>
        </header>

        <div className="blueprint-grid min-h-[calc(100svh-4rem)]">
          <main className="mx-auto w-full max-w-[1480px] p-4 sm:p-6 lg:p-8">
            <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-1 text-sm font-medium text-primary">Sábado, 5 de setembro</p>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">{activeLabel}</h1>
              </div>
              {activeView === 'overview' && (
                <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Operação saudável</span>
                  <strong>3 pontos pedem atenção</strong>
                </div>
              )}
            </div>

            {notice && (
              <output className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 size={18} /> {notice}
              </output>
            )}

            {activeView === 'overview' && <Overview projects={projects} navigate={navigate} />}
            {activeView === 'projects' && (
              <ProjectsView projects={filteredProjects} query={query} openDialog={() => setDialogOpen(true)} />
            )}
            {activeView !== 'overview' && activeView !== 'projects' && (
              <ModuleView view={activeView} notify={setNotice} />
            )}
          </main>
        </div>
      </SidebarInset>

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={addProject} />
    </SidebarProvider>
  );
}

function Overview({ projects, navigate }: { projects: Project[]; navigate: (view: ViewId) => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,.8fr)]">
      <div className="space-y-6">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div><h2 className="text-lg font-semibold tracking-tight">O que pede decisão</h2><p className="text-sm text-muted-foreground">Ordenado por impacto em prazo e resultado.</p></div>
            <Badge variant="outline">3 prioridades</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {priorities.map((item) => (
              <Card key={item.title} className="gap-3 py-4 shadow-sm">
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={item.tone === 'red' ? 'border-red-200 bg-red-50 text-red-700' : item.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-700'}>{item.label}</Badge>
                    <MoreHorizontal className="size-4 text-muted-foreground" />
                  </div>
                  <CardTitle>{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-sm text-muted-foreground">{item.context}</p>
                  <Button variant="ghost" className="-ml-2 text-primary" onClick={() => navigate(item.tone === 'amber' ? 'budgets' : 'tasks')}>{item.action}<ArrowRight /></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Card className="shadow-sm">
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle>Trabalhos ativos</CardTitle><p className="mt-1 text-sm text-muted-foreground">Prazo, etapa e avanço no mesmo lugar.</p></div>
            <Button variant="outline" onClick={() => navigate('projects')}>Ver todos</Button>
          </CardHeader>
          <CardContent><ProjectTable projects={projects.slice(0, 4)} /></CardContent>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card className="overflow-hidden shadow-sm">
          <div className="bg-[#1f3d73] px-5 py-5 text-white">
            <p className="text-sm text-blue-100">Resultado previsto em setembro</p>
            <strong className="mt-2 block text-3xl tracking-[-0.04em]">R$ 84.320</strong>
            <span className="mt-3 inline-flex items-center rounded-full bg-white/12 px-2.5 py-1 text-xs">Demonstração · integrar com Drap</span>
          </div>
          <CardContent className="grid grid-cols-2 gap-4 pt-1">
            <div><span className="text-xs text-muted-foreground">A receber</span><strong className="mt-1 block text-base">R$ 148.000</strong></div>
            <div><span className="text-xs text-muted-foreground">A pagar</span><strong className="mt-1 block text-base">R$ 63.680</strong></div>
            <Button variant="outline" className="col-span-2" onClick={() => navigate('finance')}>Ver financeiro por projeto</Button>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader><CardTitle>Funil comercial</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {[['Novos contatos', 12, 100], ['Diagnóstico', 8, 67], ['Proposta enviada', 5, 42], ['Fechamento', 3, 25]].map(([label, value, width]) => (
              <div key={String(label)}><div className="mb-2 flex justify-between text-sm"><span>{label}</span><strong>{value}</strong></div><Progress value={Number(width)} /></div>
            ))}
            <Button variant="ghost" className="w-full text-primary" onClick={() => navigate('crm')}>Abrir CRM <ArrowRight /></Button>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function ProjectsView({ projects, query, openDialog }: { projects: Project[]; query: string; openDialog: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">Todos os projetos do escritório, da primeira conversa à entrega final.</p>
        <div className="flex gap-2"><Button variant="outline"><SlidersHorizontal /> Filtrar</Button><Button onClick={openDialog}><Plus /> Novo projeto</Button></div>
      </div>
      <Card className="shadow-sm"><CardContent><ProjectTable projects={projects} /></CardContent></Card>
      {!projects.length && <div className="rounded-xl border border-dashed bg-card p-10 text-center"><Search className="mx-auto mb-3 text-muted-foreground" /><h2 className="font-semibold">Nenhum projeto encontrado</h2><p className="mt-1 text-sm text-muted-foreground">Tente buscar por outro nome, cliente ou etapa.</p></div>}
      {query && <p className="text-sm text-muted-foreground">Busca ativa: “{query}”</p>}
    </div>
  );
}

function ProjectTable({ projects }: { projects: Project[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Projeto</TableHead><TableHead>Etapa</TableHead><TableHead>Avanço</TableHead><TableHead>Prazo</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell><strong className="block font-medium">{project.name}</strong><span className="text-xs text-muted-foreground">{project.client} · {project.type}</span></TableCell>
            <TableCell>{project.stage}</TableCell>
            <TableCell><div className="flex min-w-32 items-center gap-3"><Progress value={project.progress} className="flex-1" /><span className="w-8 text-xs tabular-nums text-muted-foreground">{project.progress}%</span></div></TableCell>
            <TableCell>{project.deadline}</TableCell>
            <TableCell><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${healthStyle[project.health]}`}>{project.health}</span></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ModuleView({ view, notify }: { view: Exclude<ViewId, 'overview' | 'projects'>; notify: (message: string) => void }) {
  const content = moduleCopy[view];
  const sampleRows = view === 'tasks'
    ? [['Revisar memorial descritivo', 'Serra Azul', 'Hoje, 16h'], ['Confirmar paginação de piso', 'Casa Pátio', 'Amanhã'], ['Enviar revisão para cliente', 'Clínica Vitta', '08 set']]
    : view === 'crm'
      ? [['Studio Aurora', 'Proposta enviada', 'Hoje'], ['Fernanda e Caio', 'Diagnóstico', 'Amanhã'], ['Café Manacá', 'Novo contato', '09 set']]
      : [['Residência Serra Azul', 'Em andamento', '18 set'], ['Clínica Vitta', 'Atenção', '12 set'], ['Casa Pátio', 'Em andamento', '28 nov']];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-sm text-muted-foreground">{content.description}</p><Button onClick={() => notify(`${content.action}: fluxo preparado para a próxima etapa.`)}><Plus /> {content.action}</Button></div>
      <div className="grid gap-4 md:grid-cols-3">
        {content.stats.map(([label, value, detail], index) => <Card key={label} className="shadow-sm"><CardContent><div className="mb-5 flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span>{index === 1 ? <CircleAlert className="size-4 text-amber-600" /> : <Sparkles className="size-4 text-primary" />}</div><strong className="text-2xl tracking-[-0.03em]">{value}</strong><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>)}
      </div>
      <Card className="shadow-sm"><CardHeader><CardTitle>Em andamento</CardTitle></CardHeader><CardContent className="space-y-1">{sampleRows.map(([title, status, date]) => <button key={title} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted"><span className="grid size-9 place-items-center rounded-lg bg-secondary text-primary"><Clock3 size={17} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{title}</strong><small className="text-muted-foreground">{status}</small></span><span className="text-sm text-muted-foreground">{date}</span><ArrowRight className="size-4 text-muted-foreground" /></button>)}</CardContent></Card>
    </div>
  );
}

function NewProjectDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (data: FormData) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Novo projeto</DialogTitle><DialogDescription>Comece com o essencial. Etapas, equipe e orçamento podem ser definidos depois.</DialogDescription></DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <label htmlFor="project-name" className="grid gap-1.5 text-sm font-medium">Nome do projeto<Input id="project-name" name="name" required placeholder="Ex.: Residência Horizonte" className="h-10" /></label>
          <label htmlFor="project-client" className="grid gap-1.5 text-sm font-medium">Cliente<Input id="project-client" name="client" required placeholder="Nome da pessoa ou empresa" className="h-10" /></label>
          <label htmlFor="project-type" className="grid gap-1.5 text-sm font-medium">Tipo<select id="project-type" name="type" className="h-10 rounded-lg border bg-background px-3 text-sm"><option>Arquitetura residencial</option><option>Interiores comerciais</option><option>Reforma completa</option><option>Acompanhamento de obra</option></select></label>
          <DialogFooter className="mt-6"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit">Criar projeto</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
