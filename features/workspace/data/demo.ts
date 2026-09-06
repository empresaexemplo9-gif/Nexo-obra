import {
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarRange,
  ContactRound,
  FileStack,
  FolderKanban,
  HardHat,
  ListChecks,
  UsersRound,
} from 'lucide-react';
import type { NavItem, Project, ViewId } from '../types';

export const navigation: NavItem[] = [
  { id: 'overview', label: 'Visão geral', icon: BriefcaseBusiness },
  { id: 'projects', label: 'Projetos', icon: FolderKanban, badge: '8' },
  { id: 'works', label: 'Obras', icon: HardHat, badge: '3' },
  { id: 'budgets', label: 'Orçamentos', icon: FileStack, badge: '4' },
  { id: 'schedule', label: 'Cronograma', icon: CalendarRange },
  { id: 'crm', label: 'CRM e clientes', icon: ContactRound },
  { id: 'finance', label: 'Financeiro', icon: Banknote },
  { id: 'tasks', label: 'Tarefas', icon: ListChecks, badge: '7' },
  { id: 'team', label: 'Equipe', icon: UsersRound },
  { id: 'files', label: 'Arquivos', icon: Building2 },
];

export const initialProjects: Project[] = [
  { id: 'p-1', name: 'Residência Serra Azul', client: 'Mariana e Rafael', type: 'Arquitetura residencial', stage: 'Executivo', progress: 72, deadline: '18 set', health: 'No prazo' },
  { id: 'p-2', name: 'Clínica Vitta', client: 'Grupo Vitta', type: 'Interiores comerciais', stage: 'Compatibilização', progress: 48, deadline: '12 set', health: 'Atenção' },
  { id: 'p-3', name: 'Casa Pátio', client: 'Laura Nunes', type: 'Reforma completa', stage: 'Obra', progress: 34, deadline: '28 nov', health: 'No prazo' },
  { id: 'p-4', name: 'Loja Orbe', client: 'Orbe Design', type: 'Varejo', stage: 'Estudo preliminar', progress: 18, deadline: '09 set', health: 'Atrasado' },
];

export const priorities = [
  { tone: 'red', label: 'Prazo vencido', title: 'Aprovar layout da Loja Orbe', context: 'Loja Orbe · venceu há 2 dias', action: 'Abrir tarefa' },
  { tone: 'amber', label: 'Depende de você', title: 'Validar proposta da Clínica Vitta', context: 'Margem prevista de 21%', action: 'Revisar orçamento' },
  { tone: 'blue', label: 'Próximo marco', title: 'Entrega do executivo Serra Azul', context: 'Daqui a 6 dias · 4 pendências', action: 'Ver pendências' },
];

export const moduleCopy: Record<Exclude<ViewId, 'overview' | 'projects'>, { title: string; description: string; action: string; stats: [string, string, string][] }> = {
  works: { title: 'Obras', description: 'Avanço, diário, medições e ocorrências no mesmo contexto.', action: 'Nova obra', stats: [['Obras ativas', '3', '2 dentro do prazo'], ['Medições abertas', '5', 'R$ 86,4 mil'], ['Ocorrências', '2', '1 bloqueia serviço']] },
  budgets: { title: 'Orçamentos', description: 'Composições, versões, margem e aprovação sem planilhas dispersas.', action: 'Novo orçamento', stats: [['Em elaboração', '4', 'R$ 428 mil'], ['Aguardando cliente', '3', 'R$ 191 mil'], ['Margem média', '24%', '+3 p.p. no mês']] },
  schedule: { title: 'Cronograma', description: 'Marcos, dependências e responsáveis dos trabalhos ativos.', action: 'Adicionar marco', stats: [['Marcos esta semana', '9', '3 concluídos'], ['Em risco', '2', 'pedem decisão'], ['Carga planejada', '82%', 'da capacidade']] },
  crm: { title: 'CRM e clientes', description: 'Próximo contato claro, histórico completo e conversão sem recadastro.', action: 'Novo contato', stats: [['Oportunidades', '12', 'R$ 614 mil'], ['Propostas abertas', '5', 'R$ 238 mil'], ['Conversão', '36%', '+4% no trimestre']] },
  finance: { title: 'Financeiro', description: 'Resultado por projeto com a Drap como fonte financeira.', action: 'Abrir na Drap', stats: [['A receber', 'R$ 148 mil', 'próximos 30 dias'], ['A pagar', 'R$ 63,7 mil', 'próximos 30 dias'], ['Resultado previsto', 'R$ 84,3 mil', 'dados demonstrativos']] },
  tasks: { title: 'Tarefas', description: 'O que fazer agora, com prazo, dependência e projeto sempre visíveis.', action: 'Nova tarefa', stats: [['Minhas tarefas', '17', '7 para hoje'], ['Bloqueadas', '3', '2 aguardam cliente'], ['Concluídas', '42', 'nos últimos 7 dias']] },
  team: { title: 'Equipe', description: 'Papéis, carga e horas planejadas versus realizadas.', action: 'Convidar pessoa', stats: [['Pessoas', '8', '6 disponíveis hoje'], ['Capacidade', '82%', 'semana atual'], ['Horas apontadas', '214h', 'de 260h previstas']] },
  files: { title: 'Arquivos', description: 'A versão certa de cada documento, organizada por projeto.', action: 'Enviar arquivo', stats: [['Arquivos', '384', 'em 11 projetos'], ['Para revisar', '9', '3 vencem hoje'], ['Compartilhados', '27', 'com clientes']] },
};
