import type { getDatabase } from "@/db";

type Db = ReturnType<typeof getDatabase>;

/**
 * Registra que algo foi apagado da plataforma.
 *
 * Vai para `platform_deletions`, que não tem chave estrangeira nenhuma — e essa é a
 * razão de ela existir. `platform_audit_events` exige `organization_id` apontando para
 * uma empresa viva, e o registro de "esta empresa foi apagada" não tem para onde
 * apontar: a empresa sumiu no mesmo instante, levando junto as próprias linhas de
 * auditoria. Sem esta tabela, a ação mais destrutiva do produto seria a única sem rastro.
 *
 * `rotulo` guarda o nome legível porque um UUID solto não responde "qual empresa era
 * essa?" seis meses depois, quando alguém vier perguntar.
 */
export function registrarExclusao(db: Db, entrada: {
  tipo: "organization" | "account" | "invitation";
  subjectId: string;
  rotulo: string;
  actor: string;
  detalhes?: Record<string, unknown>;
}) {
  return db.prepare(
    `INSERT INTO platform_deletions (id, tipo, subject_id, rotulo, actor, details_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(
    crypto.randomUUID(),
    entrada.tipo,
    entrada.subjectId,
    entrada.rotulo,
    entrada.actor,
    JSON.stringify(entrada.detalhes ?? {}),
    Date.now(),
  );
}
