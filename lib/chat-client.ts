"use client";

import type { OrgFileInfo } from "@/lib/org-files-client";

// Tipos e chamadas da Comunicação do lado do navegador.

export type Conversa = {
  id: string; kind: "canal" | "direta"; name: string; otherMemberId: string | null;
  lastMessageAt: string | null; lastPreview: string | null; unread: number; canDelete: boolean;
};
export type Pessoa = { id: string; name: string };
export type ListaConversas = { me: string; conversations: Conversa[]; members: Pessoa[]; unreadTotal: number };
export type Lembrete = {
  id: string; text: string; dueDay: string; targetMemberId: string | null; targetName: string | null;
  doneAt: string | null; doneByName: string | null; canComplete: boolean;
};
export type Mensagem = {
  id: string; channelId: string; authorMemberId: string; authorName: string; clientKey: string | null; body: string;
  kind: "mensagem" | "lembrete"; createdAt: string; editedAt: string | null; deleted: boolean; mine: boolean;
  canEdit: boolean; canDelete: boolean; files: OrgFileInfo[]; reminder: Lembrete | null;
};
export type PaginaMensagens = { messages: Mensagem[]; cursor: string; hasMore: boolean };

export async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Falha de comunicação (HTTP ${response.status}).`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

export const listarConversas = () => pedir<ListaConversas>("/api/conversas");
export const abrirDireta = (memberId: string) => pedir<{ channelId: string }>("/api/conversas/diretas", { method: "POST", body: JSON.stringify({ memberId }) });
export const criarCanal = (name: string) => pedir<{ channelId: string }>("/api/conversas", { method: "POST", body: JSON.stringify({ name }) });

export type NovaMensagem = {
  clientKey: string; body: string; fileIds: string[];
  reminder?: { text: string; dueDay: string; targetMemberId: string | null };
};

export const enviarMensagem = (channelId: string, mensagem: NovaMensagem) =>
  pedir<{ message: Mensagem }>(`/api/conversas/${channelId}/mensagens`, { method: "POST", body: JSON.stringify(mensagem) });

export function horaDaMensagem(valor: string) {
  const data = new Date(valor);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function hojeLocal() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}
