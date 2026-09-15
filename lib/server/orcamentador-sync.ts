import { createHash } from "node:crypto";
import { getDatabase } from "@/db";
import { previousMonth, type Profile } from "@/lib/integrations/sinapi-contract";
import type { ItemSinapi } from "@/lib/integrations/sinapi-planilha";
import {
  fetchOrcamentadorMonthlySnapshot,
  ORCAMENTADOR_SIGNATURE,
  ORCAMENTADOR_SOURCE_COMMIT,
  orcamentadorSourceUrl,
} from "@/lib/integrations/orcamentador";
import { advanceSinapi, discardSinapi } from "./sinapi-sync";

type SyncRow = { config_json: string | null; job_id: string | null };
type JobRow = { id: string; estado: string; origem_url: string; atualizado_em: number };
type PreviousRow = { id: string; total_itens: number; laudo_json: string | null };
type Report = {
  arquivo: string;
  signatures: string[];
  semPreco: number;
  cursor: number;
  amostra: ItemSinapi[];
  alertas: string[];
  provider: "orcamentador";
  sourceCommit: string;
  consultadoEm: number;
  parametros: unknown;
  revisadoPor?: string;
  revisadoEm?: number;
};

async function syncRow(): Promise<SyncRow> {
  const db = getDatabase();
  await db.prepare("INSERT OR IGNORE INTO sinapi_sync(id) VALUES(1)").run();
  return (await db.prepare("SELECT config_json,job_id FROM sinapi_sync WHERE id=1").first<SyncRow>())!;
}

async function job(id: string | null) {
  return id ? getDatabase().prepare("SELECT id,estado,origem_url,atualizado_em FROM sinapi_competencias WHERE id=?1").bind(id).first<JobRow>() : null;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export async function monthlyOrcamentadorSinapi(token: string) {
  const db = getDatabase();
  let sync = await syncRow();
  let outstanding = await job(sync.job_id);

  if (outstanding?.estado === "aprovada") {
    await advanceSinapi(token);
    sync = await syncRow();
    outstanding = await job(sync.job_id);
  }
  if (outstanding?.estado === "baixando" && /caixa\.gov\.br/i.test(outstanding.origem_url)) {
    await discardSinapi(token);
    sync = await syncRow();
    outstanding = await job(sync.job_id);
  }
  if (outstanding && outstanding.atualizado_em < Date.now() - 7 * 86400000) {
    await discardSinapi(token);
    sync = await syncRow();
    outstanding = await job(sync.job_id);
  }
  if (outstanding) return { status: "job-em-andamento", jobId: outstanding.id };

  const profile: Profile | null = sync.config_json ? JSON.parse(sync.config_json) : null;
  if (!profile) {
    await db.prepare("UPDATE sinapi_sync SET last_checked=?1,last_error=NULL WHERE id=1 AND lock_token=?2").bind(Date.now(), token).run();
    return { status: "sem-perfil" };
  }

  const month = previousMonth();
  const active = await db.prepare("SELECT id FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND competencia>=?3 AND estado='aprovada' LIMIT 1")
    .bind(profile.uf, profile.regime, month).first<{ id: string }>();
  if (active) {
    await db.prepare("UPDATE sinapi_sync SET last_checked=?1,last_error=NULL WHERE id=1 AND lock_token=?2").bind(Date.now(), token).run();
    return { status: "competencia-atual", month };
  }

  const snapshot = await fetchOrcamentadorMonthlySnapshot(profile, month);
  if (snapshot.items.length < 100) throw new Error(`Orçamentador retornou somente ${snapshot.items.length} itens para ${profile.uf}/${profile.regime}/${month}; a referência atual foi preservada.`);

  const previous = await db.prepare("SELECT id,total_itens,laudo_json FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND estado='aprovada' ORDER BY competencia DESC LIMIT 1")
    .bind(profile.uf, profile.regime).first<PreviousRow>();
  const alerts: string[] = [];
  if (!profile.assinaturas.includes(ORCAMENTADOR_SIGNATURE)) alerts.push("A fonte automática mudou para a API do Orçamentador. Confira e aprove esta primeira competência antes de liberar as próximas atualizações automáticas.");
  if (previous?.total_itens && Math.abs(snapshot.items.length / previous.total_itens - 1) > 0.2) alerts.push("A quantidade de preços variou mais de 20%.");
  if (previous?.laudo_json) {
    const old = JSON.parse(previous.laudo_json) as { semPreco?: number };
    if (snapshot.ignored > (old.semPreco ?? 0) + 100) alerts.push("Mais de 100 itens adicionais vieram sem preço utilizável.");
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const serialized = JSON.stringify(snapshot.items);
  const report: Report = {
    arquivo: `Orçamentador API · ${month}`,
    signatures: [ORCAMENTADOR_SIGNATURE],
    semPreco: snapshot.ignored,
    cursor: snapshot.items.length,
    amostra: snapshot.items.slice(0, 20),
    alertas: alerts,
    provider: "orcamentador",
    sourceCommit: ORCAMENTADOR_SOURCE_COMMIT,
    consultadoEm: now,
    parametros: snapshot.parametros,
  };

  const statements = [
    db.prepare(`INSERT INTO sinapi_competencias(id,competencia,uf,regime,estado,origem_url,arquivo_sha256,arquivo_bytes,total_itens,laudo_json,criado_em,atualizado_em,baixado_em)
      VALUES(?1,?2,?3,?4,'importando',?5,?6,?7,?8,?9,?10,?10,?10)`)
      .bind(id, month, profile.uf, profile.regime, `${orcamentadorSourceUrl()}/insumos`, createHash("sha256").update(serialized).digest("hex"), Buffer.byteLength(serialized), snapshot.items.length, JSON.stringify(report), now),
    db.prepare("UPDATE sinapi_sync SET job_id=?1,last_checked=?2,last_error=NULL WHERE id=1 AND lock_token=?3").bind(id, now, token),
  ];
  for (const part of chunks(snapshot.items, 500)) {
    statements.push(db.prepare(`INSERT INTO sinapi_itens(id,competencia_id,codigo,descricao,unidade,custo_unitario_centavos,tipo)
      SELECT ?1 || ':' || json_extract(value,'$.tipo') || ':' || json_extract(value,'$.codigo'), ?1,
      json_extract(value,'$.codigo'),json_extract(value,'$.descricao'),json_extract(value,'$.unidade'),json_extract(value,'$.custoUnitarioCentavos'),json_extract(value,'$.tipo')
      FROM json_each(?2) WHERE EXISTS(SELECT 1 FROM sinapi_sync WHERE id=1 AND lock_token=?3)
      ON CONFLICT(competencia_id,tipo,codigo) DO NOTHING`).bind(id, JSON.stringify(part), token));
  }
  await db.batch(statements);

  const persisted = await db.prepare("SELECT count(*) n FROM sinapi_itens WHERE competencia_id=?1").bind(id).first<{ n: number }>();
  if (!persisted || persisted.n !== snapshot.items.length) {
    await db.batch([
      db.prepare("DELETE FROM sinapi_itens WHERE competencia_id=?1").bind(id),
      db.prepare("DELETE FROM sinapi_competencias WHERE id=?1").bind(id),
      db.prepare("UPDATE sinapi_sync SET job_id=NULL WHERE id=1 AND lock_token=?1").bind(token),
    ]);
    throw new Error("A quantidade persistida da referência do Orçamentador não confere; a referência anterior foi preservada.");
  }

  const variation = await db.prepare(`SELECT count(*) matched,
    sum(CASE WHEN old.unidade<>fresh.unidade OR (old.custo_unitario_centavos>0 AND abs(fresh.custo_unitario_centavos-old.custo_unitario_centavos)*1.0/old.custo_unitario_centavos>0.5) THEN 1 ELSE 0 END) changed
    FROM sinapi_itens fresh JOIN sinapi_itens old ON old.codigo=fresh.codigo AND old.tipo=fresh.tipo
    JOIN sinapi_competencias p ON p.id=old.competencia_id
    WHERE fresh.competencia_id=?1 AND p.uf=?2 AND p.regime=?3 AND p.estado='aprovada'`)
    .bind(id, profile.uf, profile.regime).first<{ matched: number; changed: number }>();
  if (variation && variation.matched > 0 && variation.changed / variation.matched > 0.05) report.alertas.push("Mais de 5% dos itens mudaram de unidade ou tiveram variação de preço superior a 50%.");

  await db.prepare("UPDATE sinapi_competencias SET estado='pendente',laudo_json=?1,atualizado_em=?2 WHERE id=?3").bind(JSON.stringify(report), Date.now(), id).run();

  const contractKnown = profile.assinaturas.includes(ORCAMENTADOR_SIGNATURE);
  if (profile.automatico && contractKnown && report.alertas.length === 0) {
    report.revisadoPor = "atualizacao-automatica-orcamentador";
    report.revisadoEm = Date.now();
    const nextProfile = { ...profile, assinaturas: [ORCAMENTADOR_SIGNATURE] };
    await db.batch([
      db.prepare("UPDATE sinapi_competencias SET estado='aprovada',aprovado_em=?1,aprovado_por=?2,laudo_json=?3 WHERE id=?4 AND estado='pendente'")
        .bind(report.revisadoEm, report.revisadoPor, JSON.stringify(report), id),
      db.prepare("DELETE FROM sinapi_itens WHERE competencia_id IN(SELECT id FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND id<>?3)").bind(profile.uf, profile.regime, id),
      db.prepare("DELETE FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND id<>?3").bind(profile.uf, profile.regime, id),
      db.prepare("UPDATE sinapi_sync SET config_json=?1,job_id=NULL,last_checked=?2,last_error=NULL WHERE id=1 AND lock_token=?3")
        .bind(JSON.stringify(nextProfile), Date.now(), token),
    ]);
    return { status: "aprovada-automaticamente", month, total: snapshot.items.length };
  }

  return { status: "aguardando-aprovacao", month, total: snapshot.items.length, alertas: report.alertas };
}
