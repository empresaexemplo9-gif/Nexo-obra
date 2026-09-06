import type { LucideIcon } from 'lucide-react';

export type ViewId =
  | 'overview'
  | 'projects'
  | 'works'
  | 'budgets'
  | 'schedule'
  | 'crm'
  | 'finance'
  | 'tasks'
  | 'team'
  | 'files';

export type NavItem = { id: ViewId; label: string; icon: LucideIcon; badge?: string };

export type Project = {
  id: string;
  name: string;
  client: string;
  type: string;
  stage: string;
  progress: number;
  deadline: string;
  health: 'No prazo' | 'Atenção' | 'Atrasado';
};
