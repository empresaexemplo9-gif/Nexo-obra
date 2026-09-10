import "server-only";

import { and, asc, eq, like, or, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { clients, projects } from "@/db/schema";
import { DEFAULT_PAGE_SIZE, nowIso } from "@/lib/data/shared";

/**
 * Consultas de clientes.
 *
 * INVARIANTE DESTE ARQUIVO: `organizationId` é o primeiro parâmetro de toda
 * função e entra em toda cláusula `where`, inclusive nas de update e delete.
 * Uma atualização que só filtra por `id` atravessaria a fronteira entre
 * empresas — por isso o par (id, organizationId) é sempre exigido junto.
 */

export type ClientRecord = typeof clients.$inferSelect;

export type ClientListItem = ClientRecord & {
  /** Projetos e obras vinculados, para a lista responder "posso excluir?". */
  projectCount: number;
};

export type ClientInput = {
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  externalFinancialId?: string | null;
  notes?: string;
};

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function listClients(
  db: Database,
  organizationId: string,
  options: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ items: ClientListItem[]; total: number }> {
  const search = options.search?.trim();
  const pattern = search ? `%${escapeLike(search)}%` : null;

  const where = and(
    eq(clients.organizationId, organizationId),
    pattern
      ? or(
          like(clients.name, pattern),
          like(clients.document, pattern),
          like(clients.email, pattern),
        )
      : undefined,
  );

  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: clients.id,
        organizationId: clients.organizationId,
        name: clients.name,
        document: clients.document,
        email: clients.email,
        phone: clients.phone,
        externalFinancialId: clients.externalFinancialId,
        notes: clients.notes,
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
        projectCount: sql<number>`(
          select count(*) from ${projects}
          where ${projects.clientId} = ${clients.id}
            and ${projects.organizationId} = ${clients.organizationId}
        )`,
      })
      .from(clients)
      .where(where)
      .orderBy(asc(clients.name))
      .limit(options.limit ?? DEFAULT_PAGE_SIZE)
      .offset(options.offset ?? 0),
    db.select({ total: sql<number>`count(*)` }).from(clients).where(where),
  ]);

  return { items, total: counted?.total ?? items.length };
}

export async function getClient(
  db: Database,
  organizationId: string,
  clientId: string,
): Promise<ClientRecord | null> {
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
    .limit(1);

  return row ?? null;
}

export async function createClient(
  db: Database,
  organizationId: string,
  input: ClientInput,
): Promise<ClientRecord> {
  const timestamp = nowIso();
  const [row] = await db
    .insert(clients)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      name: input.name,
      document: input.document ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      externalFinancialId: input.externalFinancialId ?? null,
      notes: input.notes ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  return row;
}

/** Devolve `null` quando o cliente não existe NA ORGANIZAÇÃO — vira 404. */
export async function updateClient(
  db: Database,
  organizationId: string,
  clientId: string,
  input: Partial<ClientInput>,
): Promise<ClientRecord | null> {
  const [row] = await db
    .update(clients)
    .set({ ...input, updatedAt: nowIso() })
    .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
    .returning();

  return row ?? null;
}

/**
 * Exclui apenas quando não há projeto vinculado. Apagar em cascata destruiria
 * histórico de obra; a decisão de desvincular é do usuário, não do sistema.
 */
export async function deleteClient(
  db: Database,
  organizationId: string,
  clientId: string,
): Promise<{ deleted: boolean; reason?: "not_found" | "has_projects" }> {
  const existing = await getClient(db, organizationId, clientId);
  if (!existing) return { deleted: false, reason: "not_found" };

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.organizationId, organizationId)));

  if (total > 0) return { deleted: false, reason: "has_projects" };

  await db
    .delete(clients)
    .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)));

  return { deleted: true };
}
