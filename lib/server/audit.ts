import "server-only";

import type { Database } from "@/db";
import { auditLogs } from "@/db/schema";

export type AuditAction = "create" | "update" | "delete" | "status_change";

export type AuditInput = {
  organizationId: string;
  actorMemberId: string | null;
  entity: string;
  entityId: string;
  action: AuditAction;
  changes?: Record<string, unknown>;
};

/**
 * Campos que nunca entram na trilha, mesmo que mudem. Auditoria explica a ação;
 * não é lugar para copiar segredo nem para duplicar dado pessoal desnecessário.
 */
const REDACTED_FIELDS = new Set(["document", "email", "phone", "notes"]);

/** Só o que mudou, com os campos sensíveis marcados sem revelar o valor. */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const previous = before[key];
    if (previous === value) continue;

    changes[key] = REDACTED_FIELDS.has(key)
      ? { changed: true }
      : { from: previous ?? null, to: value ?? null };
  }

  return changes;
}

/**
 * Grava a trilha.
 *
 * Nunca lança: uma falha de auditoria não pode desfazer nem esconder a operação
 * de negócio que já aconteceu. O erro vai para o log do servidor, onde o
 * monitoramento enxerga.
 */
export async function recordAudit(db: Database, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      actorMemberId: input.actorMemberId,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      changes: JSON.stringify(input.changes ?? {}),
    });
  } catch (error) {
    console.error("[audit] falha ao registrar evento", {
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      error,
    });
  }
}
