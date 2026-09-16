export type DrapCatalogItem = {
  id: string;
  name: string;
  kind: "free" | "module" | "bundle" | "plan";
  monthlyCents: number;
  annualCents?: number;
  trialDays?: number;
  modules?: string[];
  description: string;
};

// Catálogo público conferido em 2026-09-16 em https://empresa.drap.app.br/precos.
// Ele serve para apresentação dentro da H.OIKOS. O preço cobrado continua sendo confirmado
// pela DRAP no servidor no momento da contratação; o navegador nunca escolhe preço.
export const DRAP_CATALOG_SOURCE = "https://empresa.drap.app.br/precos";
export const DRAP_CATALOG_CHECKED_AT = "2026-09-16";

export const DRAP_CATALOG: readonly DrapCatalogItem[] = [
  {
    id: "gratis",
    name: "Plano grátis",
    kind: "free",
    monthlyCents: 0,
    description: "Até 30 lançamentos por mês, categorias customizadas, filtros, 1 usuário, importação Excel/CSV e backup diário.",
  },
  {
    id: "dashboards-pro",
    name: "Dashboards Pro",
    kind: "module",
    monthlyCents: 5900,
    trialDays: 14,
    description: "Comparação entre meses, drill-down por categoria e KPIs do negócio.",
  },
  {
    id: "integracoes",
    name: "Integrações",
    kind: "module",
    monthlyCents: 2900,
    trialDays: 14,
    description: "Google Sheets, API REST /api/v1 e webhooks assinados.",
  },
  {
    id: "multi-usuario",
    name: "Multi-usuário",
    kind: "module",
    monthlyCents: 3900,
    trialDays: 14,
    description: "Equipe e contador com papel e permissões por empresa.",
  },
  {
    id: "contabilidade-basica",
    name: "Contabilidade Básica",
    kind: "module",
    monthlyCents: 6900,
    trialDays: 14,
    description: "DRE, Balanço Patrimonial e pacote de fechamento em Excel.",
  },
  {
    id: "banco-conciliacao",
    name: "Banco & Conciliação",
    kind: "module",
    monthlyCents: 4900,
    trialDays: 14,
    description: "Extrato OFX, sugestão de conciliação e baixa de lançamento.",
  },
  {
    id: "fluxo-caixa-tesouraria",
    name: "Fluxo de Caixa & Tesouraria",
    kind: "module",
    monthlyCents: 6900,
    trialDays: 14,
    description: "Projeção diária, contas a pagar/receber e orçamento.",
  },
  {
    id: "emissao-nota-fiscal",
    name: "Emissão de Nota Fiscal",
    kind: "module",
    monthlyCents: 7900,
    trialDays: 14,
    description: "NFS-e e NF-e de produto direto pela DRAP.",
  },
  {
    id: "cobrancas",
    name: "Cobranças",
    kind: "module",
    monthlyCents: 5900,
    trialDays: 14,
    description: "Boleto, PIX e cartão com conciliação do lançamento pago.",
  },
  {
    id: "ia-assistente",
    name: "IA Assistente",
    kind: "module",
    monthlyCents: 4900,
    trialDays: 14,
    description: "Categoriza lançamento, lê comprovante e auxilia no plano de contas.",
  },
  {
    id: "assistente-whatsapp",
    name: "Assistente WhatsApp",
    kind: "module",
    monthlyCents: 2900,
    trialDays: 14,
    description: "Consulta saldo, contas e resumo pelo WhatsApp por regras da DRAP.",
  },
  {
    id: "pacote-essencial",
    name: "Pacote Essencial",
    kind: "bundle",
    monthlyCents: 13900,
    trialDays: 14,
    modules: ["dashboards-pro", "banco-conciliacao", "ia-assistente"],
    description: "Dashboards Pro, Banco & Conciliação e IA Assistente.",
  },
  {
    id: "pacote-fiscal",
    name: "Pacote Fiscal",
    kind: "bundle",
    monthlyCents: 15900,
    trialDays: 14,
    modules: ["emissao-nota-fiscal", "contabilidade-basica", "cobrancas"],
    description: "Emissão de Nota Fiscal, Contabilidade Básica e Cobranças.",
  },
  {
    id: "pacote-profissional",
    name: "Pacote Profissional",
    kind: "bundle",
    monthlyCents: 32900,
    trialDays: 14,
    description: "Pacote de 8 módulos conforme o catálogo vigente da DRAP.",
  },
  {
    id: "pacote-completo",
    name: "Pacote Completo",
    kind: "bundle",
    monthlyCents: 34900,
    trialDays: 14,
    modules: [
      "dashboards-pro",
      "integracoes",
      "multi-usuario",
      "contabilidade-basica",
      "banco-conciliacao",
      "fluxo-caixa-tesouraria",
      "emissao-nota-fiscal",
      "cobrancas",
      "ia-assistente",
      "assistente-whatsapp",
    ],
    description: "Os 10 módulos vendáveis do catálogo DRAP.",
  },
  {
    id: "retaguarda-mensal",
    name: "DRAP Retaguarda",
    kind: "plan",
    monthlyCents: 99000,
    annualCents: 990000,
    description: "Plano Retaguarda por empresa, com módulos, IA de análise, implantação e atendimento publicados pela DRAP.",
  },
] as const;

export function drapCatalogItem(id: string) {
  return DRAP_CATALOG.find((item) => item.id === id) ?? null;
}
