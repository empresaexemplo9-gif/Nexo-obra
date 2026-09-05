export type ProjectStatus = "Em dia" | "Atenção" | "Atrasado";

export type Project = {
  id: string;
  code: string;
  name: string;
  client: string;
  kind: "Projeto" | "Obra";
  phase: string;
  progress: number;
  status: ProjectStatus;
  nextMilestone: string;
  budget: number;
  spent: number;
  owner: string;
};

export const projects: Project[] = [
  {
    id: "prj_aurora",
    code: "ARQ-026",
    name: "Residência Aurora",
    client: "Marina e Paulo",
    kind: "Projeto",
    phase: "Executivo",
    progress: 68,
    status: "Em dia",
    nextMilestone: "Compatibilização · 09 set",
    budget: 148000,
    spent: 86140,
    owner: "Camila",
  },
  {
    id: "prj_atrio",
    code: "OBR-018",
    name: "Clínica Átrio",
    client: "Átrio Saúde",
    kind: "Obra",
    phase: "Instalações",
    progress: 43,
    status: "Atenção",
    nextMilestone: "Medição elétrica · hoje",
    budget: 492000,
    spent: 246900,
    owner: "Rafael",
  },
  {
    id: "prj_lume",
    code: "ARQ-031",
    name: "Apartamento Lume",
    client: "Renata Borges",
    kind: "Projeto",
    phase: "Detalhamento",
    progress: 82,
    status: "Em dia",
    nextMilestone: "Caderno final · 12 set",
    budget: 58500,
    spent: 42120,
    owner: "Lívia",
  },
  {
    id: "prj_cedro",
    code: "OBR-021",
    name: "Casa Cedro",
    client: "Eduardo Lima",
    kind: "Obra",
    phase: "Acabamentos",
    progress: 76,
    status: "Atrasado",
    nextMilestone: "Entrega da marcenaria · 03 set",
    budget: 736000,
    spent: 618500,
    owner: "Bruno",
  },
];

export const focusTasks = [
  { id: "tsk_1", title: "Aprovar medição elétrica", context: "Clínica Átrio", due: "Hoje, 10:30", level: "Crítica", owner: "Você" },
  { id: "tsk_2", title: "Enviar revisão do executivo", context: "Residência Aurora", due: "Hoje, 14:00", level: "Alta", owner: "Camila" },
  { id: "tsk_3", title: "Confirmar entrega da marcenaria", context: "Casa Cedro", due: "Vencida há 2 dias", level: "Crítica", owner: "Bruno" },
  { id: "tsk_4", title: "Retornar proposta comercial", context: "Lead · Loja Limoeiro", due: "Hoje, 16:00", level: "Normal", owner: "Você" },
];

export const opportunities = [
  { stage: "Novo contato", count: 4, value: 126000, color: "#7f8da5" },
  { stage: "Diagnóstico", count: 3, value: 98000, color: "#466fda" },
  { stage: "Proposta", count: 5, value: 284000, color: "#b8781f" },
  { stage: "Negociação", count: 2, value: 164000, color: "#7558b7" },
];

export const crmCards = [
  { id: "crm_1", stage: "Novo contato", name: "Reforma Comercial Arandu", client: "Juliana Mendes", value: 38000, next: "Responder briefing" },
  { id: "crm_2", stage: "Diagnóstico", name: "Escritório Lótus", client: "Lótus Advocacia", value: 68000, next: "Visita técnica · 08 set" },
  { id: "crm_3", stage: "Proposta", name: "Casa Horizonte", client: "Guilherme Assis", value: 146000, next: "Follow-up · hoje" },
  { id: "crm_4", stage: "Proposta", name: "Loja Limoeiro", client: "Grupo Limoeiro", value: 92000, next: "Apresentação · 16:00" },
  { id: "crm_5", stage: "Negociação", name: "Cobertura Ipê", client: "Marcela e André", value: 164000, next: "Ajustar escopo" },
];

export const budgets = [
  { id: "orc_92", code: "ORC-092", title: "Projeto completo · Casa Horizonte", client: "Guilherme Assis", version: "v3", value: 146000, margin: 34, status: "Aguardando cliente", updatedAt: "Hoje, 08:42" },
  { id: "orc_91", code: "ORC-091", title: "Reforma · Loja Limoeiro", client: "Grupo Limoeiro", version: "v2", value: 92000, margin: 29, status: "Em revisão", updatedAt: "Ontem, 17:18" },
  { id: "orc_90", code: "ORC-090", title: "Interiores · Apartamento Foz", client: "Isabela Porto", version: "v1", value: 68500, margin: 31, status: "Aprovado", updatedAt: "02 set, 11:06" },
];

export const team = [
  { name: "Camila Freire", role: "Arquiteta líder", load: 78, hours: "31h / 40h", initials: "CF" },
  { name: "Rafael Nunes", role: "Engenheiro de obra", load: 92, hours: "37h / 40h", initials: "RN" },
  { name: "Lívia Prado", role: "Arquiteta", load: 64, hours: "26h / 40h", initials: "LP" },
  { name: "Bruno Sales", role: "Coordenador", load: 108, hours: "43h / 40h", initials: "BS" },
];

export const files = [
  { name: "Executivo_Aurora_R06.pdf", project: "Residência Aurora", type: "PDF", size: "18,4 MB", author: "Camila", updatedAt: "Há 18 min" },
  { name: "Medicao_eletrica_03.xlsx", project: "Clínica Átrio", type: "Planilha", size: "642 KB", author: "Rafael", updatedAt: "Hoje, 09:12" },
  { name: "Ata_reuniao_cliente.docx", project: "Apartamento Lume", type: "Documento", size: "84 KB", author: "Lívia", updatedAt: "Ontem, 18:04" },
  { name: "Fotos_vistoria_04.zip", project: "Casa Cedro", type: "Arquivo", size: "124 MB", author: "Bruno", updatedAt: "Ontem, 15:37" },
];

export const schedule = [
  { label: "Levantamento", project: "Residência Aurora", start: 0, span: 18, progress: 100 },
  { label: "Anteprojeto", project: "Residência Aurora", start: 12, span: 25, progress: 100 },
  { label: "Executivo", project: "Residência Aurora", start: 32, span: 38, progress: 68 },
  { label: "Compatibilização", project: "Residência Aurora", start: 65, span: 25, progress: 18 },
  { label: "Instalações", project: "Clínica Átrio", start: 8, span: 42, progress: 43 },
  { label: "Acabamentos", project: "Casa Cedro", start: 44, span: 40, progress: 76 },
];

export const demoFinancialSummary = {
  currentBalance: 184260,
  receivables: 128400,
  payables: 76480,
  projected30d: 236180,
  overdueReceivables: 18400,
  updatedAt: "2026-09-05T20:55:00.000Z",
  source: "demo" as const,
};

export const cashFlow = [
  { label: "Mai", income: 112, expense: 78 },
  { label: "Jun", income: 94, expense: 82 },
  { label: "Jul", income: 138, expense: 91 },
  { label: "Ago", income: 126, expense: 104 },
  { label: "Set", income: 154, expense: 88 },
  { label: "Out", income: 142, expense: 96 },
];
