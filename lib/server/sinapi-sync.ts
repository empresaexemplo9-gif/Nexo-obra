import { createHash, timingSafeEqual } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { getDatabase } from "@/db";
import { ApiError } from "./api-error";
import { runtimeEnv } from "./runtime";
import { inspectReference, parseMapped, referenceFile } from "@/lib/integrations/sinapi-mapped";
import { previousMonth, sourceUrl, type Mapping, type Profile } from "@/lib/integrations/sinapi-contract";
import type { ItemSinapi } from "@/lib/integrations/sinapi-planilha";

type Sync = { config_json: string | null; job_id: string | null; last_checked: number | null; last_error: string | null };
type Job = { id: string; competencia: string; uf: string; regime: string; estado: string; total_itens: number; laudo_json: string | null; origem_url: string; falha: string | null; arquivo_sha256: string | null };
type Report = { arquivo?: string; abas?: ReturnType<typeof inspectReference>; signatures?: string[]; semPreco?: number; cursor?: number; amostra?: ItemSinapi[]; alertas?: string[]; revisadoPor?: string; revisadoEm?: number; cleanup?: boolean };
export type SinapiIO = { read(key: string): Promise<Buffer>; write(key: string, bytes: Buffer): Promise<void>; remove(key: string): Promise<void>; download(url: string): Promise<Buffer> };
const LIMIT = 80 * 1024 * 1024;
async function bounded(response: Response, limit = LIMIT) {
  if (!response.body) throw new Error("Arquivo vazio.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error("Arquivo excede 80 MB."); chunks.push(value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export const sinapiIO: SinapiIO = {
  async read(key) { const result = await get(key, { access: "private", token: runtimeEnv().BLOB_READ_WRITE_TOKEN, useCache: false }); if (!result?.stream) throw new Error("Arquivo temporário indisponível; tente novamente."); return bounded(new Response(result.stream)); },
  async write(key, bytes) { if (bytes.length > LIMIT) throw new Error("Arquivo temporário excede 80 MB."); await put(key, new Blob([Uint8Array.from(bytes)]), { access: "private", token: runtimeEnv().BLOB_READ_WRITE_TOKEN, addRandomSuffix: false, allowOverwrite: true, contentType: "application/octet-stream" }); },
  async remove(key) { await del(key, { token: runtimeEnv().BLOB_READ_WRITE_TOKEN }); },
  async download(url) {
    // URL construída no servidor. Nenhuma URL fornecida pelo navegador e nenhum redirect.
    const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Caixa respondeu HTTP ${response.status}. A tabela vigente foi preservada.`);
    return bounded(response);
  },
};
const keys = (id: string) => [`sinapi-temporario/${id}/referencia.xlsx`, `sinapi-temporario/${id}/itens.json`];
const reportOf = (job: Job): Report => JSON.parse(job.laudo_json ?? "{}");
const fail = (message: string) => new ApiError(409, "sinapi_state", message);
async function settings() { return (await getDatabase().prepare("SELECT * FROM sinapi_sync WHERE id = 1").first<Sync>())!; }
async function currentJob(sync: Sync) { return sync.job_id ? getDatabase().prepare("SELECT * FROM sinapi_competencias WHERE id = ?1").bind(sync.job_id).first<Job>() : null; }

export async function sinapiStatus() {
  const sync = await getDatabase().prepare("SELECT * FROM sinapi_sync WHERE id = 1").first<Sync>();
  const jobs = await getDatabase().prepare("SELECT * FROM sinapi_competencias ORDER BY criado_em DESC LIMIT 60").all<Job>();
  return { config: sync?.config_json ? JSON.parse(sync.config_json) as Profile : null, jobId: sync?.job_id, lastChecked: sync?.last_checked, error: sync?.last_error,
    schedulerConfigured: Boolean(runtimeEnv().CRON_SECRET), storageConfigured: Boolean(runtimeEnv().BLOB_READ_WRITE_TOKEN),
    jobs: jobs.results.map((j) => ({ ...j, report: reportOf(j), laudo_json: undefined })) };
}

// Todas as mutações passam por este lease, inclusive a aprovação. O limite da função é
// 300s, inferior aos 600s do lease; o token também cerca cada escrita de checkpoint.
export async function withSinapiLock<T>(action: (token: string) => Promise<T>) {
  const db = getDatabase(); const token = crypto.randomUUID(); const now = Date.now();
  await db.prepare("INSERT OR IGNORE INTO sinapi_sync(id) VALUES(1)").run();
  const acquired = await db.prepare("UPDATE sinapi_sync SET lock_token=?1, locked_until=?2 WHERE id=1 AND locked_until < ?3 RETURNING id").bind(token, now + 600000, now).all();
  if (!acquired.results.length) throw fail("Já existe uma atualização em andamento. Aguarde a conclusão.");
  try { return await action(token); }
  catch (error) { await db.prepare("UPDATE sinapi_sync SET last_error=?1 WHERE id=1 AND lock_token=?2").bind(error instanceof Error ? error.message.slice(0, 500) : "Falha na atualização.", token).run(); throw error; }
  finally { await db.prepare("UPDATE sinapi_sync SET lock_token=NULL, locked_until=0 WHERE id=1 AND lock_token=?1").bind(token).run(); }
}
async function saveJob(job: Job, report: Report, token: string) {
  await getDatabase().prepare(`UPDATE sinapi_competencias SET estado=?1, laudo_json=?2, total_itens=?3, atualizado_em=?4, falha=NULL
    WHERE id=?5 AND EXISTS(SELECT 1 FROM sinapi_sync WHERE id=1 AND lock_token=?6)`)
    .bind(job.estado, JSON.stringify(report), job.total_itens, Date.now(), job.id, token).run();
}
export async function startSinapi(month: string, profile: Profile, token: string) {
  const db = getDatabase(); const sync = await settings();
  if (sync.job_id) throw fail("Conclua ou descarte a conferência em andamento antes de iniciar outra.");
  const newer = await db.prepare("SELECT id FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND competencia>=?3 AND estado='aprovada'").bind(profile.uf, profile.regime, month).first();
  if (newer) throw fail("Essa competência ou uma mais recente já está ativa.");
  const id = crypto.randomUUID(); const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO sinapi_competencias(id,competencia,uf,regime,estado,origem_url,criado_em,atualizado_em) VALUES(?1,?2,?3,?4,'baixando',?5,?6,?6)`).bind(id, month, profile.uf, profile.regime, sourceUrl(month), now),
    db.prepare("UPDATE sinapi_sync SET config_json=?1,job_id=?2,last_error=NULL WHERE id=1 AND lock_token=?3").bind(JSON.stringify(profile), id, token),
  ]);
}
export async function mapSinapi(maps: Mapping[], token: string) {
  const sync = await settings(); const job = await currentJob(sync);
  if (!job || job.estado !== "conferindo") throw fail("Baixe uma referência antes de selecionar as colunas.");
  const config: Profile = JSON.parse(sync.config_json!);
  config.mapas = maps; config.assinaturas = []; config.automatico = false;
  await getDatabase().prepare("UPDATE sinapi_sync SET config_json=?1 WHERE id=1 AND lock_token=?2").bind(JSON.stringify(config), token).run();
  job.estado = "interpretando"; await saveJob(job, reportOf(job), token);
}
export async function setSinapiAutomatic(enabled: boolean, token: string) {
  const sync = await settings(); if (!sync.config_json) throw fail("Confira e ative a primeira tabela.");
  const config: Profile = JSON.parse(sync.config_json);
  if (enabled && !config.assinaturas.length) throw fail("Confira e ative a primeira tabela antes de habilitar a renovação automática.");
  config.automatico = enabled;
  await getDatabase().prepare("UPDATE sinapi_sync SET config_json=?1 WHERE id=1 AND lock_token=?2").bind(JSON.stringify(config), token).run();
}
async function cleanFiles(id: string, io: SinapiIO) { for (const key of keys(id)) await io.remove(key); }
export async function discardSinapi(token: string, io = sinapiIO) {
  const sync = await settings(); const job = await currentJob(sync); if (!job) return;
  if (job.estado === "aprovada") throw fail("A tabela já está ativa. Use processar para concluir a limpeza.");
  await cleanFiles(job.id, io);
  await getDatabase().batch([
    getDatabase().prepare("DELETE FROM sinapi_itens WHERE competencia_id=?1").bind(job.id),
    getDatabase().prepare("DELETE FROM sinapi_competencias WHERE id=?1").bind(job.id),
    getDatabase().prepare("UPDATE sinapi_sync SET job_id=NULL,last_error=NULL WHERE id=1 AND lock_token=?1").bind(token),
  ]);
}
export async function activateSinapi(actor: string, token: string) {
  const db = getDatabase(); const sync = await settings(); const job = await currentJob(sync);
  if (!job || job.estado !== "pendente") throw fail("A referência ainda não terminou a validação.");
  const count = await db.prepare("SELECT count(*) n FROM sinapi_itens WHERE competencia_id=?1").bind(job.id).first<{ n: number }>();
  if (!count || count.n !== job.total_itens || count.n < 100) throw fail("A quantidade persistida não confere com o laudo.");
  const report = reportOf(job); const config: Profile = JSON.parse(sync.config_json!);
  if (!report.signatures?.length) throw fail("Laudo sem assinatura do cabeçalho.");
  config.assinaturas = report.signatures;
  report.revisadoPor = actor; report.revisadoEm = Date.now(); report.cleanup = true; delete report.abas;
  // Ativação e remoção anteriores na MESMA transação. Itens de orçamento são snapshots
  // independentes e não possuem FK para a referência: permanecem intactos.
  await db.batch([
    db.prepare("UPDATE sinapi_competencias SET estado='aprovada',aprovado_em=?1,aprovado_por=?2,laudo_json=?3 WHERE id=?4 AND estado='pendente'").bind(Date.now(), actor, JSON.stringify(report), job.id),
    db.prepare("DELETE FROM sinapi_itens WHERE competencia_id IN(SELECT id FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND id<>?3)").bind(job.uf, job.regime, job.id),
    db.prepare("DELETE FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND id<>?3").bind(job.uf, job.regime, job.id),
    db.prepare("UPDATE sinapi_sync SET config_json=?1,last_error=NULL WHERE id=1 AND lock_token=?2").bind(JSON.stringify(config), token),
  ]);
}

export async function advanceSinapi(token: string, io = sinapiIO, budgetMs = 180000) {
  const db = getDatabase(); const sync = await settings(); const job = await currentJob(sync);
  if (!job) return;
  const profile: Profile = JSON.parse(sync.config_json!); const report = reportOf(job); const [xlsxKey, itemsKey] = keys(job.id);
  if (job.estado === "aprovada") {
    await cleanFiles(job.id, io); report.cleanup = false;
    await saveJob(job, report, token);
    await db.prepare("UPDATE sinapi_sync SET job_id=NULL,last_error=NULL WHERE id=1 AND lock_token=?1").bind(token).run(); return;
  }
  if (job.estado === "baixando") {
    const bytes = await io.download(job.origem_url); const file = referenceFile(bytes, job.competencia);
    report.arquivo = file.name; report.abas = inspectReference(file.bytes);
    // Chaves determinísticas registradas pelo ID antes do upload; crash não deixa órfãos.
    await io.write(xlsxKey, file.bytes);
    await db.prepare("UPDATE sinapi_competencias SET arquivo_sha256=?1,arquivo_bytes=?2,baixado_em=?3 WHERE id=?4").bind(createHash("sha256").update(bytes).digest("hex"), bytes.length, Date.now(), job.id).run();
    job.estado = profile.assinaturas.length ? "interpretando" : "conferindo";
    await saveJob(job, report, token); return;
  }
  if (job.estado === "interpretando") {
    const parsed = parseMapped(await io.read(xlsxKey), profile.mapas);
    report.signatures = parsed.signatures; report.semPreco = parsed.semPreco; report.cursor = 0;
    report.amostra = [...parsed.itens.slice(0, 5), ...parsed.itens.slice(-5)]; report.alertas = [];
    const previous = await db.prepare("SELECT total_itens,laudo_json FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND estado='aprovada' ORDER BY competencia DESC LIMIT 1").bind(job.uf, job.regime).first<{ total_itens: number; laudo_json: string }>();
    if (profile.assinaturas.length && JSON.stringify(parsed.signatures) !== JSON.stringify(profile.assinaturas)) {
      // Não usa os preços produzidos com um cabeçalho diferente.
      job.estado = "conferindo"; report.alertas.push("As colunas mudaram. Selecione e confira novamente antes de continuar.");
      await saveJob(job, report, token); return;
    }
    if (previous && Math.abs(parsed.itens.length / previous.total_itens - 1) > 0.2) report.alertas.push("A quantidade de preços variou mais de 20%.");
    if (previous) { const old = JSON.parse(previous.laudo_json) as Report; if (parsed.semPreco > (old.semPreco ?? 0) + 100) report.alertas.push("Mais de 100 itens adicionais estão sem preço."); }
    await io.write(itemsKey, Buffer.from(JSON.stringify(parsed.itens)));
    job.total_itens = parsed.itens.length; job.estado = "importando";
    await saveJob(job, report, token); return;
  }
  if (job.estado === "importando") {
    const items = JSON.parse((await io.read(itemsKey)).toString()) as ItemSinapi[]; const end = Date.now() + budgetMs;
    if (items.length !== job.total_itens) throw fail("Arquivo normalizado incompleto.");
    do {
      const cursor = report.cursor ?? 0; const chunk = items.slice(cursor, cursor + 500); if (!chunk.length) break;
      report.cursor = cursor + chunk.length;
      await db.batch([
        db.prepare(`INSERT INTO sinapi_itens(id,competencia_id,codigo,descricao,unidade,custo_unitario_centavos,tipo)
          SELECT ?1 || ':' || json_extract(value,'$.tipo') || ':' || json_extract(value,'$.codigo'), ?1,
          json_extract(value,'$.codigo'), json_extract(value,'$.descricao'), json_extract(value,'$.unidade'), json_extract(value,'$.custoUnitarioCentavos'), json_extract(value,'$.tipo')
          FROM json_each(?2) WHERE EXISTS(SELECT 1 FROM sinapi_sync WHERE lock_token=?3)
          ON CONFLICT(competencia_id,tipo,codigo) DO NOTHING`).bind(job.id, JSON.stringify(chunk), token),
        db.prepare("UPDATE sinapi_competencias SET laudo_json=?1,atualizado_em=?2 WHERE id=?3 AND EXISTS(SELECT 1 FROM sinapi_sync WHERE lock_token=?4)").bind(JSON.stringify(report), Date.now(), job.id, token),
      ]);
    } while ((report.cursor ?? 0) < items.length && Date.now() < end);
    if (report.cursor === items.length) {
      const variation = await db.prepare(`SELECT count(*) matched,
        sum(CASE WHEN old.unidade<>fresh.unidade OR abs(fresh.custo_unitario_centavos-old.custo_unitario_centavos) > max(old.custo_unitario_centavos,1)*0.5 THEN 1 ELSE 0 END) changed
        FROM sinapi_itens fresh JOIN sinapi_itens old ON old.codigo=fresh.codigo AND old.tipo=fresh.tipo
        JOIN sinapi_competencias previous ON previous.id=old.competencia_id
        WHERE fresh.competencia_id=?1 AND previous.uf=?2 AND previous.regime=?3 AND previous.estado='aprovada'`)
        .bind(job.id, job.uf, job.regime).first<{ matched: number; changed: number }>();
      if (variation && variation.matched > 0 && variation.changed / variation.matched > 0.05) report.alertas?.push("Mais de 5% dos itens mudaram de unidade ou tiveram variação de preço superior a 50%.");
      job.estado = "pendente"; await saveJob(job, report, token);
      if (profile.automatico && profile.assinaturas.length && !report.alertas?.length) await activateSinapi("atualizacao-automatica", token);
    }
  }
  await db.prepare("UPDATE sinapi_sync SET last_error=NULL WHERE id=1 AND lock_token=?1").bind(token).run();
}
export function authorizeSinapiCron(request: Request) {
  const secret = runtimeEnv().CRON_SECRET;
  const value = request.headers.get("authorization") ?? "";
  const received = Buffer.from(value); const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || received.length !== expected.length || !timingSafeEqual(received, expected)) throw new ApiError(401, "unauthorized", "Agendamento não autorizado.");
}
export async function monthlySinapi(token: string, io = sinapiIO) {
  const db = getDatabase(); let sync = await settings();
  const profile: Profile | null = sync.config_json ? JSON.parse(sync.config_json) : null;
  const outstanding = await currentJob(sync);
  if (outstanding?.estado === "aprovada") await advanceSinapi(token, io);
  // Tentativas abandonadas não acumulam planilhas nem itens parciais. A base ativa fica.
  if (outstanding && outstanding.estado !== "aprovada") {
    const expired = await db.prepare("SELECT id FROM sinapi_competencias WHERE id=?1 AND atualizado_em < ?2").bind(outstanding.id, Date.now() - 7 * 86400000).first();
    if (expired) await discardSinapi(token, io);
  }
  sync = await settings();
  if (!profile?.automatico) return;
  if (!sync.job_id) {
    const month = previousMonth();
    const current = await db.prepare("SELECT id FROM sinapi_competencias WHERE uf=?1 AND regime=?2 AND competencia>=?3 AND estado='aprovada'").bind(profile.uf, profile.regime, month).first();
    if (!current) await startSinapi(month, profile, token);
  }
  await db.prepare("UPDATE sinapi_sync SET last_checked=?1 WHERE id=1 AND lock_token=?2").bind(Date.now(), token).run();
  // Até quatro fases por chamada; o checkpoint importando pode continuar amanhã.
  const deadline = Date.now() + 230000;
  for (let i = 0; i < 4 && Date.now() < deadline - 10000; i++) {
    sync = await settings(); const job = await currentJob(sync);
    if (!job || ["conferindo", "pendente"].includes(job.estado)) break;
    await advanceSinapi(token, io, Math.max(1000, deadline - Date.now() - 10000));
  }
}
