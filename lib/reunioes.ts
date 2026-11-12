import { z } from "zod";

// Pedido de reunião do visitante. O mesmo esquema valida o formulário e a borda do
// servidor, então a tela nunca aceita o que a API recusa.

export const TAMANHOS_EQUIPE = ["1", "2-5", "6-15", "16-50", "50+"] as const;
export const tamanhoEquipeLabels: Record<typeof TAMANHOS_EQUIPE[number], string> = {
  "1": "Só eu", "2-5": "2 a 5 pessoas", "6-15": "6 a 15 pessoas", "16-50": "16 a 50 pessoas", "50+": "Mais de 50 pessoas",
};

export const PERIODOS = ["manha", "tarde", "fim-de-tarde"] as const;
export const periodoLabels: Record<typeof PERIODOS[number], string> = {
  manha: "Manhã (9h às 12h)", tarde: "Tarde (13h às 17h)", "fim-de-tarde": "Fim de tarde (17h às 19h)",
};

export const ORIGENS = ["home", "painel", "cad", "layout", "documentos"] as const;
export type OrigemReuniao = typeof ORIGENS[number];
export const origemLabels: Record<OrigemReuniao, string> = {
  home: "Página inicial", painel: "Escritório de exemplo", cad: "Editor CAD", layout: "Criador de layout", documentos: "Documentos e PDF",
};
export const origemValida = (valor: string | null | undefined): OrigemReuniao =>
  (ORIGENS as readonly string[]).includes(valor ?? "") ? valor as OrigemReuniao : "home";

export const STATUS_REUNIAO = ["new", "contacted", "closed"] as const;
export type StatusReuniao = typeof STATUS_REUNIAO[number];
export const statusReuniaoLabels: Record<StatusReuniao, string> = { new: "Novo", contacted: "Contato feito", closed: "Encerrado" };

/** Dia de hoje em AAAA-MM-DD no fuso de Brasília, que é onde a reunião acontece. */
export function hojeEmBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
const somarDias = (dia: string, dias: number) => {
  const data = new Date(`${dia}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};
/** Último dia aceito: 60 dias à frente. Mais que isso não é agenda, é intenção. */
export const ultimoDiaAceito = (hoje = hojeEmBrasilia()) => somarDias(hoje, 60);
export function diaUtil(dia: string) {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return semana !== 0 && semana !== 6;
}

export const pedidoReuniaoSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo.").max(120),
  company: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(160),
  phone: z.string().trim().max(30).refine((valor) => valor.replace(/\D/g, "").length >= 10, "Informe o telefone com DDD."),
  teamSize: z.enum(TAMANHOS_EQUIPE, { message: "Escolha o tamanho da equipe." }),
  preferredDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha um dia."),
  preferredPeriod: z.enum(PERIODOS, { message: "Escolha um período." }),
  message: z.string().trim().max(1000).optional().transform((valor) => valor || null),
  origin: z.enum(ORIGENS).optional().default("home"),
  // Campo-isca: fica fora da tela e de leitores de tela. Preenchido, é robô.
  website: z.string().max(200).optional(),
}).strict();
export type PedidoReuniao = z.infer<typeof pedidoReuniaoSchema>;

/** Erro do dia preferido, ou `null`. Depende de "hoje", por isso fica fora do esquema. */
export function erroDoDia(dia: string, hoje = hojeEmBrasilia()) {
  if (Number.isNaN(new Date(`${dia}T12:00:00Z`).getTime())) return "Escolha um dia válido.";
  if (dia <= hoje) return "Escolha um dia a partir de amanhã.";
  if (dia > ultimoDiaAceito(hoje)) return "Escolha um dia nos próximos 60 dias.";
  if (!diaUtil(dia)) return "Escolha um dia de segunda a sexta.";
  return null;
}
