import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test, { beforeEach, after } from "node:test";
import { createServer } from "vite";
import { montarZip, xlsx } from "./helpers/sinapi-fixtures.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = {}; globalThis.__platformEnvOverride = runtime;
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const sync = await vite.ssrLoadModule("/lib/server/sinapi-sync.ts");
const parser = await vite.ssrLoadModule("/lib/integrations/sinapi-mapped.ts");
const adminRoute = await vite.ssrLoadModule("/app/api/superadmin/sinapi/route.ts");
const cronRoute = await vite.ssrLoadModule("/app/api/cron/sinapi/route.ts");
const searchRoute = await vite.ssrLoadModule("/app/api/integrations/sinapi/items/route.ts");
const adminSession = await vite.ssrLoadModule("/lib/server/superadmin.ts");
const { abrirZip } = await vite.ssrLoadModule("/lib/integrations/planilha-zip.ts");
const { abrirPlanilha } = await vite.ssrLoadModule("/lib/integrations/planilha-xlsx.ts");
const migrations = await Promise.all((await readdir(`${root}/drizzle`)).filter((f) => f.endsWith(".sql")).sort().map((f) => readFile(`${root}/drizzle/${f}`, "utf8")));
class LocalDB {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql) {
    const sqlite = this.sqlite; let args = [];
    const execute = () => ({ results: sqlite.prepare(sql).all(Object.fromEntries(args.map((v, i) => [i + 1, v]))), success: true, meta: {} });
    return { bind(...values) { args = values; return this; }, execute, async all() { return execute(); }, async run() { return execute(); }, async first() { return execute().results[0] ?? null; } };
  }
  async batch(statements) { this.sqlite.exec("BEGIN"); try { const result = statements.map((s) => s.execute()); this.sqlite.exec("COMMIT"); return result; } catch (e) { this.sqlite.exec("ROLLBACK"); throw e; } }
}
const mappings = [{ aba: "Composições SD", tipo: "composicao", cabecalho: 2, codigo: 0, descricao: 1, unidade: 2, preco: 3 }, { aba: "Insumos SD", tipo: "insumo", cabecalho: 2, codigo: 0, descricao: 1, unidade: 2, preco: 3 }];
const profile = () => ({ uf: "SP", regime: "NaoDesonerado", automatico: false, mapas: [], assinaturas: [] });
const workbook = (count = 501, header = "SP", price = "1.234,56") => xlsx(Object.fromEntries(mappings.map((m) => [m.aba, [["SINAPI"], ["Código", "Descrição", "Unidade", header, "RJ"], ...Array.from({ length: count }, (_, i) => [String(i + 1), `Serviço ${i + 1}`, "M2", price, "99,00"])]])));
let db; let objects; let bytes; let downloads; let io;
beforeEach(() => {
  db?.sqlite.close(); db = new LocalDB(); db.sqlite.exec("PRAGMA foreign_keys=ON"); for (const sql of migrations) db.sqlite.exec(sql);
  Object.assign(runtime, { DB: db, CRON_SECRET: "test-secret", SUPERADMIN_EMAIL: "admin@example.test", SUPERADMIN_PASSWORD_HASH: "test-only", SUPERADMIN_SESSION_SECRET: "test-only-shared-secret-at-least-32-characters" }); objects = new Map(); bytes = workbook(); downloads = 0;
  io = { async download(url) { downloads++; const month = /SINAPI-(\d{4}-\d{2})/.exec(url)[1]; return montarZip({ [`SINAPI_Referência_${month.replace('-', '_')}.xlsx`]: bytes }); }, async write(key, value) { objects.set(key, value); }, async read(key) { if (!objects.has(key)) throw new Error("missing"); return objects.get(key); }, async remove(key) { objects.delete(key); } };
});
after(async () => { db?.sqlite.close(); await vite.close(); delete globalThis.__platformEnvOverride; });
const locked = (action) => sync.withSinapiLock(action);
async function prepare(month = "2026-04", config = profile()) {
  await locked((token) => sync.startSinapi(month, config, token));
  await locked((token) => sync.advanceSinapi(token, io));
  if (!(await sync.sinapiStatus()).config.assinaturas.length) await locked((token) => sync.mapSinapi(mappings, token));
  await locked((token) => sync.advanceSinapi(token, io));
}
async function importAll() { await locked((token) => sync.advanceSinapi(token, io)); }
async function activate() { await locked((token) => sync.activateSinapi("admin@example.test", token)); await locked((token) => sync.advanceSinapi(token, io)); }

test("importação real de ZIP/XLSX, checkpoint, colisão entre tipos e limpeza", async () => {
  await prepare(); assert.equal(downloads, 1);
  await locked((token) => sync.advanceSinapi(token, io, 0));
  let status = await sync.sinapiStatus(); assert.equal(status.jobs[0].report.cursor, 500); assert.equal(status.jobs[0].estado, "importando");
  await importAll(); status = await sync.sinapiStatus(); assert.equal(status.jobs[0].estado, "pendente"); assert.equal(status.jobs[0].total_itens, 1002);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sinapi_itens WHERE codigo='1'").get().n, 2);
  assert.equal(db.sqlite.prepare("SELECT custo_unitario_centavos FROM sinapi_itens LIMIT 1").get().custo_unitario_centavos, 123456);
  await activate(); assert.equal(objects.size, 0); status = await sync.sinapiStatus(); assert.equal(status.jobId, null); assert.equal(status.jobs[0].estado, "aprovada");
  await assert.rejects(locked((token) => sync.startSinapi("2026-03", status.config, token)), /mais recente/);
});
test("falha de download preserva a referência ativa e o job pode retomar", async () => {
  await prepare(); await importAll(); await activate(); const old = (await sync.sinapiStatus()).jobs[0].id;
  await locked((token) => sync.startSinapi("2026-05", (profile()), token));
  await assert.rejects(locked((token) => sync.advanceSinapi(token, { ...io, download: async () => { throw new Error("HTTP 429"); } })), /429/);
  assert.equal(db.sqlite.prepare("SELECT estado FROM sinapi_competencias WHERE id=?").get(old).estado, "aprovada");
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sinapi_itens WHERE competencia_id=?").get(old).n, 1002);
  assert.match((await sync.sinapiStatus()).error, /429/);
  await locked((token) => sync.advanceSinapi(token, io)); assert.equal((await sync.sinapiStatus()).jobs.find((j) => j.estado === "conferindo").competencia, "2026-05");
});
test("troca é transacional: falha de exclusão reverte ativação", async () => {
  await prepare(); await importAll(); await activate(); const old = (await sync.sinapiStatus()).jobs[0].id;
  await prepare("2026-05", (await sync.sinapiStatus()).config); await importAll();
  db.sqlite.exec(`CREATE TRIGGER prevent_delete BEFORE DELETE ON sinapi_itens WHEN OLD.competencia_id='${old}' BEGIN SELECT RAISE(ABORT,'falha simulada'); END`);
  await assert.rejects(locked((token) => sync.activateSinapi("admin", token)), /falha simulada/);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sinapi_competencias WHERE estado='aprovada'").get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sinapi_competencias WHERE estado='pendente'").get().n, 1);
  db.sqlite.exec("DROP TRIGGER prevent_delete"); await activate();
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sinapi_competencias").get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT competencia FROM sinapi_competencias").get().competencia, "2026-05");
});
test("cron renova automaticamente só com contrato homologado e não duplica mês", async () => {
  await prepare("2025-01"); await importAll(); await activate(); await locked((token) => sync.setSinapiAutomatic(true, token));
  await locked((token) => sync.monthlySinapi(token, io)); await locked((token) => sync.monthlySinapi(token, io));
  const status = await sync.sinapiStatus(); assert.equal(status.jobs.length, 1); assert.equal(status.jobs[0].estado, "aprovada"); assert.equal(status.jobs[0].report.revisadoPor, "atualizacao-automatica"); assert.equal(downloads, 2); assert.equal(objects.size, 0);
  await locked((token) => sync.monthlySinapi(token, io)); assert.equal(downloads, 2);
});
test("mudança de cabeçalho bloqueia automação antes de importar preços", async () => {
  await prepare(); await importAll(); await activate(); const config = (await sync.sinapiStatus()).config; config.automatico = true;
  bytes = workbook(501, "Preço RJ"); await prepare("2026-05", config);
  const status = await sync.sinapiStatus(); const job = status.jobs.find((j) => j.id === status.jobId);
  assert.equal(job.estado, "conferindo"); assert.match(job.report.alertas[0], /colunas mudaram/);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM sinapi_itens WHERE competencia_id=?").get(job.id).n, 0);
});
test("anomalia de contagem exige aprovação mesmo com automático habilitado", async () => {
  await prepare(); await importAll(); await activate(); const config = (await sync.sinapiStatus()).config; config.automatico = true;
  bytes = workbook(150); await prepare("2026-05", config); await importAll();
  const status = await sync.sinapiStatus(); const job = status.jobs.find((j) => j.id === status.jobId);
  assert.equal(job.estado, "pendente"); assert.match(job.report.alertas[0], /20%/);
});
test("variação ampla de preço exige revisão e não substitui a base vigente", async () => {
  await prepare(); await importAll(); await activate(); const config = (await sync.sinapiStatus()).config; config.automatico = true;
  bytes = workbook(501, "SP", "9.000,00"); await prepare("2026-05", config); await importAll();
  const status = await sync.sinapiStatus(); const job = status.jobs.find((j) => j.id === status.jobId);
  assert.equal(job.estado, "pendente"); assert.match(job.report.alertas[0], /variação de preço/);
});
test("busca usa apenas referência ativa, respeita regime e retorna competência real", async () => {
  await prepare(); await importAll(); await activate();
  const organization = "11111111-1111-4111-8111-111111111111";
  db.sqlite.prepare("INSERT INTO organizations(id,name,slug,created_at,updated_at) VALUES(?,?,?,0,0)").run(organization, "Teste", "teste");
  const cookie = (await adminSession.createSuperAdminSessionCookie()).cookie.split(";")[0];
  const request = (query) => new Request(`https://platform.test/api/integrations/sinapi/items?${query}`, { headers: { cookie: `${cookie}; __Host-nexo-organization=${organization}` } });
  const result = await searchRoute.GET(request("q=Serviço&uf=SP&regime=NaoDesonerado")); assert.equal(result.status, 200);
  const data = await result.json(); assert.equal(data.referenceMonth, "2026-04"); assert.equal(data.items[0].unitCostCents, 123456); assert.match(data.items[0].sourceReference, /NaoDesonerado/);
  assert.equal((await searchRoute.GET(request("q=Serviço&uf=SP&regime=Desonerado"))).status, 503);
  assert.equal((await searchRoute.GET(request("q=Serviço&uf=SP&referenceMonth=2026-03"))).status, 503);
  assert.equal((await searchRoute.GET(request("q=Serviço&uf=ZZ"))).status, 400);
  assert.equal((await searchRoute.GET(new Request("https://platform.test/api/integrations/sinapi/items?q=Serviço&uf=SP"))).status, 401);
});
test("lease impede execução concorrente, expira e não libera lock de outro processo", async () => {
  await locked(async () => { await assert.rejects(locked(async () => {}), /andamento/); });
  db.sqlite.prepare("UPDATE sinapi_sync SET lock_token='old',locked_until=?").run(Date.now() - 1);
  await locked(async () => { db.sqlite.prepare("UPDATE sinapi_sync SET lock_token='new'").run(); });
  assert.equal(db.sqlite.prepare("SELECT lock_token FROM sinapi_sync").get().lock_token, "new");
});
test("descartar remove itens e temporários da tentativa, preservando tabela ativa", async () => {
  await prepare(); await importAll(); await activate(); await prepare("2026-05", (await sync.sinapiStatus()).config);
  await locked((token) => sync.advanceSinapi(token, io, 0)); await locked((token) => sync.discardSinapi(token, io));
  assert.equal(objects.size, 0); assert.equal((await sync.sinapiStatus()).jobs.length, 1); assert.equal((await sync.sinapiStatus()).jobs[0].estado, "aprovada");
});
test("cron limpa tentativa abandonada mesmo com automação desligada", async () => {
  await prepare(); db.sqlite.prepare("UPDATE sinapi_competencias SET atualizado_em=1").run();
  await locked((token) => sync.monthlySinapi(token, io)); assert.equal(objects.size, 0); assert.equal((await sync.sinapiStatus()).jobs.length, 0);
});
test("rotas administrativas e cron recusam chamadas sem autorização", async () => {
  assert.equal((await adminRoute.GET(new Request("https://platform.test/api/superadmin/sinapi"))).status, 401);
  assert.equal((await adminRoute.POST(new Request("https://platform.test/api/superadmin/sinapi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", confirmed: true }) }))).status, 401);
  assert.equal((await cronRoute.GET(new Request("https://platform.test/api/cron/sinapi"))).status, 401);
  assert.throws(() => sync.authorizeSinapiCron(new Request("https://platform.test", { headers: { Authorization: "Bearer ééééééééééé" } })), /autorizado/);
});
test("parser recusa duplicação, preço ilegível, ZIP corrompido e mês errado", () => {
  const duplicate = xlsx({ "Composições SD": [["SINAPI"], ["Código", "Descrição", "Unidade", "SP"], ...Array.from({ length: 101 }, () => ["1", "Teste", "M2", "1,00"]) ] });
  assert.throws(() => parser.parseMapped(duplicate, [mappings[0]]), /duplicado/);
  assert.throws(() => parser.parseMapped(workbook(501, "SP", "erro"), mappings), /inválido/);
  assert.throws(() => parser.referenceFile(montarZip({ "SINAPI_Referência_2026_04.xlsx": bytes }), "2026-05"), /competência/);
  const corrupt = montarZip({ "test.txt": "hello" }); corrupt[38] ^= 1;
  assert.throws(() => abrirZip(corrupt).extrair("test.txt"));
});
test("XLSX mantém linhas omitidas, células autocontidas e ordem dos atributos", () => {
  const value = montarZip({ "xl/workbook.xml": '<workbook><sheets><sheet name="Dados" r:id="rId1"/></sheets></workbook>', "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1"/></Relationships>', "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="2"><c r="A2"/><c r="B2"><v>25</v></c></row><row r="4"/><row r="5"><c r="A5"><v>99</v></c></row></sheetData></worksheet>' });
  assert.deepEqual(abrirPlanilha(value).linhas("Dados"), [[], ["", "25"], [], [], ["99"]]);
});
