import { z } from "zod";

// Proposta comercial: o documento que o cliente recebe, lê e aceita.
//
// Este arquivo é compartilhado entre servidor e navegador: só tipos, validação e funções
// puras. Nada de banco, segredo ou rede aqui.

export const PROPOSAL_STATUSES = ["draft", "scheduled", "sent", "accepted", "cancelled"] as const;
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];
export const PROPOSAL_CHANNELS = ["email", "whatsapp", "link"] as const;
export type ProposalChannel = typeof PROPOSAL_CHANNELS[number];

export const proposalStatusLabels: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  sent: "Enviada",
  accepted: "Aceita",
  cancelled: "Cancelada",
};

export const proposalChannelLabels: Record<ProposalChannel, string> = {
  email: "e-mail",
  whatsapp: "WhatsApp",
  link: "link copiado",
};

const text = (max: number) => z.string().trim().max(max);

export const proposalSectionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: text(120),
  body: text(8000),
}).strict();

export const proposalItemSchema = z.object({
  id: z.string().trim().min(1).max(40),
  description: text(500).min(1, "Descreva o item."),
  unit: text(20).default("un"),
  quantity: z.number().finite().min(0).max(1_000_000_000),
  unitPriceCents: z.number().int().min(0).max(100_000_000_000),
}).strict();

export const proposalContentSchema = z.object({
  heading: text(160),
  sectionsBefore: z.array(proposalSectionSchema).max(20),
  itemsTitle: text(120),
  items: z.array(proposalItemSchema).max(300),
  discountCents: z.number().int().min(0).max(100_000_000_000),
  sectionsAfter: z.array(proposalSectionSchema).max(20),
  closing: text(2000),
}).strict();

export type ProposalSection = z.infer<typeof proposalSectionSchema>;
export type ProposalItem = z.infer<typeof proposalItemSchema>;
export type ProposalContent = z.infer<typeof proposalContentSchema>;

export function newId() {
  return crypto.randomUUID().slice(0, 12);
}

/** Texto inicial de uma proposta nova. Tudo aqui é editável na tela. */
export function defaultProposalContent(items: ProposalItem[] = []): ProposalContent {
  return {
    heading: "Proposta comercial",
    sectionsBefore: [
      { id: newId(), title: "Apresentação", body: "Agradecemos a oportunidade de apresentar esta proposta. A seguir estão o escopo, os valores e as condições para a realização do trabalho." },
      { id: newId(), title: "Escopo dos serviços", body: "" },
    ],
    itemsTitle: "Investimento",
    items,
    discountCents: 0,
    sectionsAfter: [
      { id: newId(), title: "Prazo de execução", body: "" },
      { id: newId(), title: "Condições de pagamento", body: "" },
      { id: newId(), title: "Observações", body: "Valores válidos até a data de validade desta proposta. Serviços não descritos no escopo serão orçados à parte." },
    ],
    closing: "Ficamos à disposição para esclarecer qualquer ponto.",
  };
}

/** Total de cada linha em centavos, arredondado uma vez só, como na exibição. */
export function itemTotalCents(item: Pick<ProposalItem, "quantity" | "unitPriceCents">) {
  return Math.round(item.quantity * item.unitPriceCents);
}

export function proposalTotals(content: Pick<ProposalContent, "items" | "discountCents">) {
  const subtotalCents = content.items.reduce((sum, item) => sum + itemTotalCents(item), 0);
  const discountCents = Math.min(content.discountCents, subtotalCents);
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

export const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const formatQuantity = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/**
 * Data e hora por extenso: "17 de outubro de 2026 às 10:32". No documento vai o fuso da
 * empresa; na tela da equipe, sem fuso, vale o relógio de quem está olhando.
 */
export function formatDateTime(ms: number, timezone?: string) {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" };
  try { return new Date(ms).toLocaleString("pt-BR", timezone ? { ...options, timeZone: timezone } : options); }
  catch { return new Date(ms).toLocaleString("pt-BR", { ...options, timeZone: "America/Sao_Paulo" }); }
}

export function formatDate(ms: number, timezone?: string) {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  try { return new Date(ms).toLocaleDateString("pt-BR", timezone ? { ...options, timeZone: timezone } : options); }
  catch { return new Date(ms).toLocaleDateString("pt-BR", { ...options, timeZone: "America/Sao_Paulo" }); }
}

export function validUntil(issuedAt: number, validityDays: number) {
  return issuedAt + validityDays * 86_400_000;
}

/** Mensagem que acompanha o link. O usuário pode editar antes de enviar. */
export function defaultProposalMessage(input: { recipientName: string; organizationName: string; code: string; title: string }) {
  const firstName = input.recipientName.trim().split(/\s+/)[0] ?? "";
  return [
    `Olá${firstName ? `, ${firstName}` : ""}!`,
    "",
    `Segue a proposta ${input.code} — ${input.title}.`,
    "Pelo link você lê a proposta completa e, se estiver de acordo, registra o aceite na própria página.",
    "",
    input.organizationName,
  ].join("\n");
}

/**
 * Número de WhatsApp no formato internacional, só dígitos. Número brasileiro sem DDI
 * (10 ou 11 dígitos) ganha o 55. Retorna null quando não dá para confiar no número.
 */
export function whatsappNumber(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return digits;
  return null;
}

export function whatsappUrl(phone: string | null | undefined, message: string, link: string) {
  const number = whatsappNumber(phone);
  const body = encodeURIComponent(`${message}\n\n${link}`);
  return number ? `https://wa.me/${number}?text=${body}` : `https://wa.me/?text=${body}`;
}

export function emailUrl(email: string | null | undefined, subject: string, message: string, link: string) {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${message}\n\n${link}`)}`;
  return `mailto:${encodeURIComponent((email ?? "").trim())}?${query}`;
}

export function gmailUrl(email: string | null | undefined, subject: string, message: string, link: string) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: (email ?? "").trim(), su: subject, body: `${message}\n\n${link}` });
  return `https://mail.google.com/mail/?${params.toString()}`;
}
