import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDbOrNull } from "@/db";
import { members, organizations } from "@/db/schema";
import { resolveIdentity, type Identity } from "@/lib/auth/identity";
import { isRole, type Role } from "@/lib/auth/roles";

/**
 * Resolução da organização ativa — o coração do isolamento multiempresa.
 *
 * Regra: `organizationId` NUNCA vem do navegador. O cookie abaixo guarda apenas
 * uma PREFERÊNCIA de qual organização abrir. Ele é reconferido contra as
 * associações reais do usuário a cada requisição; um cookie apontando para uma
 * empresa da qual o usuário não participa é simplesmente ignorado.
 *
 * É por isso que o cookie não precisa ser assinado: ele não concede nada.
 */

export const ACTIVE_ORGANIZATION_COOKIE = "nexo_org";

export type Membership = {
  memberId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
};

export type AuthState =
  /** Sem identidade: nenhuma sessão na borda autenticada. */
  | { status: "anonymous" }
  /** Banco indisponível — a interface mostra indisponibilidade, não demonstração. */
  | { status: "unavailable"; identity: Identity }
  /** Autenticado, mas sem vínculo com nenhuma empresa. Leva ao onboarding. */
  | { status: "no-organization"; identity: Identity }
  | {
      status: "authenticated";
      identity: Identity;
      /** Todas as empresas do usuário, para o seletor. */
      memberships: Membership[];
      /** A empresa ativa. Toda query desta requisição filtra por ela. */
      active: Membership;
    };

/** Contexto já estreitado, do jeito que as rotas de escrita precisam. */
export type AuthenticatedContext = Extract<AuthState, { status: "authenticated" }>;

function toRole(value: string): Role {
  // Papel desconhecido no banco cai no menos privilegiado, nunca no mais.
  return isRole(value) ? value : "client";
}

/**
 * Carrega as associações do usuário, ou `null` quando o banco não responde.
 *
 * O binding existir não significa que o schema esteja aplicado: em um ambiente
 * novo as tabelas podem não existir ainda. Por isso a consulta é protegida — a
 * falha vira o estado "indisponível", que a tela explica, em vez de um 500 sem
 * sentido para o usuário.
 */
async function loadMemberships(identity: Identity): Promise<Membership[] | null> {
  const db = getDbOrNull();
  if (!db) return null;

  try {
    const rows = await db
      .select({
        memberId: members.id,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        role: members.role,
      })
      .from(members)
      .innerJoin(organizations, eq(members.organizationId, organizations.id))
      .where(and(eq(members.externalUserId, identity.subject), eq(members.active, true)))
      .orderBy(asc(organizations.name));

    return rows.map((row) => ({ ...row, role: toRole(row.role) }));
  } catch (error) {
    console.error("[auth] não foi possível ler as associações do usuário", error);
    return null;
  }
}

export async function getAuthState(): Promise<AuthState> {
  const identity = await resolveIdentity();
  if (!identity) return { status: "anonymous" };

  const memberships = await loadMemberships(identity);
  if (memberships === null) return { status: "unavailable", identity };
  if (memberships.length === 0) return { status: "no-organization", identity };

  const preferred = (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const active =
    memberships.find((membership) => membership.organizationId === preferred) ??
    memberships[0];

  return { status: "authenticated", identity, memberships, active };
}

/* -------------------------------------------------------------------------- */
/* Erros de acesso, com o status HTTP já decidido                             */
/* -------------------------------------------------------------------------- */

export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = "Autenticação necessária.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class NoOrganizationError extends Error {
  readonly status = 403;

  constructor(message = "Sua conta ainda não pertence a nenhuma empresa.") {
    super(message);
    this.name = "NoOrganizationError";
  }
}

export class DatabaseUnavailableError extends Error {
  readonly status = 503;

  constructor(message = "Banco de dados indisponível no momento.") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * Porta de entrada das rotas autenticadas. Lança em vez de devolver `null` para
 * que esquecer o tratamento vire erro visível, e não vazamento silencioso.
 */
export async function requireAuth(): Promise<AuthenticatedContext> {
  const state = await getAuthState();

  switch (state.status) {
    case "anonymous":
      throw new UnauthorizedError();
    case "unavailable":
      throw new DatabaseUnavailableError();
    case "no-organization":
      throw new NoOrganizationError();
    case "authenticated":
      return state;
  }
}
