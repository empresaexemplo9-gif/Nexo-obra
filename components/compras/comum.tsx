"use client";

import type { ComponentProps, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { lerValorBrasileiro } from "@/lib/drap-envelope";
import { rotuloSituacao, rotuloStatus, type SituacaoDaEntrega, type StatusCompra } from "@/lib/compras";

export type Projeto = { id: string; code: string; name: string; kind: "project" | "work" };

export type PedidoResumo = {
  id: string; number: number; code: string; title: string; status: StatusCompra; priority: string;
  projectId: string | null; projectName: string | null; projectCode: string | null;
  neededBy: string | null; deliveryAddress: string; notes: string;
  selectedQuoteId: string | null; supplierId: string | null; supplierName: string | null;
  orderNumber: string; orderedAt: string | null; expectedDeliveryDate: string | null;
  carrier: string; trackingCode: string; dispatchedAt: string | null; deliveredAt: string | null;
  cancelReason: string; revision: number; createdByName: string; createdAt: string; updatedAt: string;
  itemCount: number; quoteCount: number; totalCents: number | null; bestQuoteCents: number | null; referenceCents: number | null;
  partial: boolean; delivery: SituacaoDaEntrega | null;
};

export type Fornecedor = {
  id: string; name: string; document: string; contactName: string; email: string; phone: string; city: string; uf: string;
  categories: string; paymentTerms: string; leadTimeDays: number | null; negotiationScore: number | null; notes: string; active: boolean;
  stats: { quotes: number; won: number; delivered: number; onTime: number; averageLeadDays: number | null; purchasedCents: number };
};

export type Produto = {
  id: string; code: string; name: string; category: string; unit: string; brand: string; specification: string;
  source: string; sourceReference: string | null; referenceCostCents: number | null; referenceLabel: string;
  lastQuotedCents: number | null; quoteCount: number;
};

export class ErroDeApi extends Error {
  constructor(message: string, public code?: string, public details?: unknown) { super(message); }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string; details?: unknown };
  if (!response.ok) {
    const campos = body.details && typeof body.details === "object" ? Object.values(body.details as Record<string, unknown>).flat().filter((v) => typeof v === "string") as string[] : [];
    throw new ErroDeApi(campos.length && body.code === "validation_error" ? campos.join(" ") : body.error ?? "Não foi possível concluir a operação.", body.code, body.details);
  }
  return body as T;
}

export const mensagem = (erro: unknown, padrao: string) => erro instanceof Error ? erro.message : padrao;

export function dinheiro(centavos: number | null | undefined) {
  if (centavos === null || centavos === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

export function dataCurta(dia: string | null | undefined) {
  if (!dia) return "—";
  const [ano, mes, d] = dia.slice(0, 10).split("-");
  return `${d}/${mes}/${ano}`;
}

export const numero = (valor: number) => valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** "1.234,56" → 123456 centavos. Vazio vira `vazio`; texto que não é número vira null. */
export function lerCentavos(texto: string, vazio: number | null = 0): number | null {
  if (!texto.trim()) return vazio;
  const valor = lerValorBrasileiro(texto);
  return valor === null || valor < 0 ? null : Math.round(valor * 100);
}

export function lerQuantidade(texto: string): number | null {
  const valor = lerValorBrasileiro(texto);
  return valor === null || valor <= 0 ? null : valor;
}

export const centavosParaTexto = (centavos: number | null | undefined) =>
  centavos === null || centavos === undefined ? "" : (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tomDoStatus: Record<StatusCompra, string> = {
  a_orcar: "border-drap-300 bg-drap-50 text-drap-800",
  a_comprar: "border-drap-500 bg-drap-100 text-drap-900",
  comprado: "border-drap-600 bg-drap-600 text-white",
  em_entrega: "border-drap-700 bg-drap-700 text-white",
  entregue: "border-drap-200 bg-white text-drap-600",
  cancelado: "border-drap-200 bg-white text-drap-500 line-through",
};

export function SeloStatus({ status }: { status: StatusCompra }) {
  return <Badge variant="outline" className={tomDoStatus[status]}>{rotuloStatus[status]}</Badge>;
}

export function SeloEntrega({ situacao }: { situacao: SituacaoDaEntrega | null }) {
  if (!situacao) return null;
  const alerta = situacao === "atrasada" || situacao === "depois_da_necessidade" || situacao === "sem_previsao";
  return <Badge variant={alerta ? "destructive" : "outline"} className={alerta ? "" : "text-drap-700"}>{rotuloSituacao[situacao]}</Badge>;
}

export function Campo({ id, label, children, ajuda }: { id: string; label: string; children: ReactNode; ajuda?: string }) {
  return <div className="min-w-0 [&_[data-slot=native-select-wrapper]]:w-full"><label htmlFor={id} className="mb-1.5 block text-sm font-medium text-drap-700">{label}</label>{children}{ajuda ? <p className="mt-1 text-xs text-drap-500">{ajuda}</p> : null}</div>;
}

export function CampoTexto({ id, label, ajuda, ...props }: { id: string; label: string; ajuda?: string } & ComponentProps<typeof Input>) {
  return <Campo id={id} label={label} ajuda={ajuda}><Input id={id} {...props} /></Campo>;
}

export function CampoArea({ id, label, ...props }: { id: string; label: string } & ComponentProps<typeof Textarea>) {
  return <Campo id={id} label={label}><Textarea id={id} {...props} /></Campo>;
}

export function Escolha({ id, label, value, onChange, options, name, defaultValue, required, ajuda }: {
  id: string; label: string; options: { value: string; label: string }[]; value?: string; onChange?: (value: string) => void;
  name?: string; defaultValue?: string; required?: boolean; ajuda?: string;
}) {
  return <Campo id={id} label={label} ajuda={ajuda}>
    <NativeSelect id={id} name={name} value={value} defaultValue={value === undefined ? defaultValue : undefined} required={required}
      onChange={onChange ? (event) => onChange(event.target.value) : undefined} className="bg-white">
      {options.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
    </NativeSelect>
  </Campo>;
}
