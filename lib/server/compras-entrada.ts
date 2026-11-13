import { z } from "zod";

import { PRIORIDADES } from "@/lib/compras";

// Formato aceito na borda do servidor para Compras. Dinheiro em centavos inteiros;
// quantidade com até três casas, como a nota fiscal de material.

export const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.");
export const centavos = z.number().int().min(0).max(100_000_000_000);
export const quantidade = z.number().positive("A quantidade precisa ser maior que zero.").max(10_000_000)
  .transform((valor) => Math.round(valor * 1000) / 1000);

export const itemEntrada = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(2, "Descreva o item.").max(300),
  unit: z.string().trim().min(1).max(16).default("un"),
  quantity: quantidade,
}).strict();

export const pedidoNovo = z.object({
  title: z.string().trim().min(3, "Dê um nome ao pedido.").max(140),
  projectId: z.string().min(1).max(80).nullable().default(null),
  neededBy: dia.nullable().default(null),
  priority: z.enum(PRIORIDADES).default("normal"),
  deliveryAddress: z.string().trim().max(300).default(""),
  notes: z.string().trim().max(2000).default(""),
  items: z.array(itemEntrada).max(200).default([]),
  // Itens copiados de um orçamento real da empresa; o servidor lê o orçamento.
  budgetVersionId: z.string().uuid().nullable().default(null),
}).strict();

export const pedidoAlteracao = z.object({
  revision: z.number().int().min(1),
  title: z.string().trim().min(3).max(140).optional(),
  projectId: z.string().min(1).max(80).nullable().optional(),
  neededBy: dia.nullable().optional(),
  priority: z.enum(PRIORIDADES).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(itemEntrada).max(200).optional(),
  // Logística: só enquanto o material não chegou.
  orderNumber: z.string().trim().max(60).optional(),
  expectedDeliveryDate: dia.nullable().optional(),
  carrier: z.string().trim().max(120).optional(),
  trackingCode: z.string().trim().max(120).optional(),
}).strict();

export const cotacaoEntrada = z.object({
  supplierId: z.string().uuid(),
  deliveryDays: z.number().int().min(0).max(365),
  paymentTerms: z.string().trim().max(120).default(""),
  paymentDays: z.number().int().min(0).max(365).default(0),
  freightCents: centavos.default(0),
  discountCents: centavos.default(0),
  validUntil: dia.nullable().default(null),
  negotiationScore: z.number().int().min(1).max(5).default(3),
  notes: z.string().trim().max(1000).default(""),
  prices: z.array(z.object({ itemId: z.string().uuid(), unitPriceCents: centavos }).strict()).max(200),
}).strict();

export const acaoEntrada = z.discriminatedUnion("action", [
  z.object({ action: z.literal("escolher"), revision: z.number().int().min(1), quoteId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("reabrir"), revision: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("comprar"), revision: z.number().int().min(1), orderNumber: z.string().trim().max(60).default(""), orderedAt: dia.optional(), expectedDeliveryDate: dia.nullable().optional() }).strict(),
  z.object({ action: z.literal("despachar"), revision: z.number().int().min(1), carrier: z.string().trim().max(120).default(""), trackingCode: z.string().trim().max(120).default(""), expectedDeliveryDate: dia.nullable().optional() }).strict(),
  z.object({ action: z.literal("receber"), revision: z.number().int().min(1), receivedAt: dia.optional(), note: z.string().trim().max(500).default(""),
    items: z.array(z.object({ itemId: z.string().uuid(), quantity: quantidade }).strict()).min(1).max(200) }).strict(),
  z.object({ action: z.literal("cancelar"), revision: z.number().int().min(1), reason: z.string().trim().min(3, "Diga o motivo do cancelamento.").max(500) }).strict(),
]);

const texto = (max: number) => z.string().trim().max(max).default("");
export const fornecedorEntrada = z.object({
  name: z.string().trim().min(2, "Informe o nome do fornecedor.").max(140),
  document: z.string().trim().max(20).transform((v) => v.replace(/\D/g, "")).refine((v) => v === "" || v.length === 11 || v.length === 14, "CPF tem 11 dígitos e CNPJ 14.").default(""),
  contactName: texto(120), email: z.union([z.literal(""), z.string().trim().email("E-mail inválido.").max(160)]).default(""),
  phone: texto(40), city: texto(80), uf: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a sigla da UF.")]).default(""),
  categories: texto(300), paymentTerms: texto(120),
  leadTimeDays: z.number().int().min(0).max(365).nullable().default(null),
  negotiationScore: z.number().int().min(1).max(5).nullable().default(null),
  notes: texto(2000),
}).strict();

export const produtoManual = z.object({
  code: texto(40),
  name: z.string().trim().min(2, "Informe o nome do produto.").max(200),
  category: z.string().trim().min(1).max(80).default("Geral"),
  unit: z.string().trim().min(1).max(16).default("un"),
  brand: texto(80), specification: texto(1000),
  referenceCostCents: centavos.nullable().default(null),
}).strict();

export const produtoDoCatalogo = z.object({ reference: z.string().trim().min(5).max(200) }).strict();
