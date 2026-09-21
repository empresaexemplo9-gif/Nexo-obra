import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

/**
 * Apagar uma empresa.
 *
 * É a operação irreversível do superadministrador, e o que pode dar errado nela não
 * aparece lendo código: ou a ordem das exclusões respeita as chaves estrangeiras ou o
 * banco recusa, e ou a lista de tabelas está completa ou sobra linha órfã apontando para
 * uma empresa que não existe mais.
 *
 * Por isso estes testes rodam contra um libSQL de verdade, com as migrações aplicadas e
 * `PRAGMA foreign_keys` ligado — igual à produção.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });

globalThis.__platformEnvOverride = { DATABASE_URL: "file::memory:" };

const { getDatabase, closeDatabase } = await vite.ssrLoadModule("/db/index.ts");
const { applyMigrations } = await vite.ssrLoadModule("/lib/server/migrations.ts");
const apagar = await vite.ssrLoadModule("/lib/server/apagar-empresa.ts");

let db;
before(async () => {
  db = getDatabase();
  await applyMigrations(db);
});
after(async () => {
  closeDatabase();
  await vite.close();
  delete globalThis.__platformEnvOverride;
});

const agora = Date.now();
const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
const contar = async (tabela, onde, valor) =>
  (await db.prepare(`SELECT count(*) AS n FROM ${tabela} WHERE ${onde} = ?1`).bind(valor).first()).n;

/** Uma empresa com dado espalhado nos cantos que uma exclusão ingênua deixa para trás. */
async function semear(orgId, sufixo) {
  await run("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", orgId, `Empresa ${sufixo}`, `empresa-${sufixo}`, agora);
  await run("INSERT INTO clients (id, organization_id, name, created_at, updated_at) VALUES (?1, ?2, 'Cliente', ?3, ?3)", `cli-${sufixo}`, orgId, agora);
  await run("INSERT INTO projects (id, organization_id, name, code, type, created_at, updated_at) VALUES (?1, ?2, 'Obra', ?3, 'work', ?4, ?4)", `prj-${sufixo}`, orgId, `OB-${sufixo}`, agora);
  await run("INSERT INTO tasks (id, organization_id, project_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, 'Tarefa', ?4, ?4)", `tsk-${sufixo}`, orgId, `prj-${sufixo}`, agora);
  await run("INSERT INTO budget_versions (id, organization_id, code) VALUES (?1, ?2, ?3)", `bv-${sufixo}`, orgId, `ORC-${sufixo}`);
  // Sem `organization_id`: pendura em budget_versions. É a linha que uma exclusão que só
  // olha a coluna deixaria para trás.
  await run("INSERT INTO budget_items (id, budget_version_id, description) VALUES (?1, ?2, 'Item')", `bi-${sufixo}`, `bv-${sufixo}`);
  // Tabela viva que NÃO existe em db/schema.ts — veio da primeira migração. `actor_user_id`
  // tem chave estrangeira para `users`, então o autor precisa existir de verdade.
  await run("INSERT OR IGNORE INTO users (id, email, created_at, updated_at) VALUES ('autor', 'autor@x.com', ?1, ?1)", agora);
  await run("INSERT INTO audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, created_at) VALUES (?1, ?2, 'autor', 'a', 'e', 'x', ?3)", `ae-${sufixo}`, orgId, agora);
  await run("INSERT INTO worksheets (id, organization_id, name, created_by_name, created_at, updated_at) VALUES (?1, ?2, 'Planilha', 'Alguém', ?3, ?3)", `ws-${sufixo}`, orgId, agora);
}

async function vincular(userId, email, orgId, sufixo) {
  await run("INSERT OR IGNORE INTO users (id, email, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)", userId, email, agora);
  await run("INSERT OR IGNORE INTO user_credentials (user_id, email, password_hash, display_name, password_updated_at, created_at) VALUES (?1, ?2, 'hash', 'Nome', ?3, ?3)", userId, email, agora);
  await run("INSERT INTO organization_members (id, organization_id, user_id, role, created_at) VALUES (?1, ?2, ?3, 'owner', ?4)", `om-${sufixo}`, orgId, userId, agora);
  await run("INSERT INTO members (id, organization_id, external_user_id, name, email) VALUES (?1, ?2, ?3, 'Nome', ?4)", `mb-${sufixo}`, orgId, userId, email);
}

test("o mapa da exclusão sai do banco, e inclui o que o schema não declara", async () => {
  const mapa = await apagar.mapaDaExclusao(db);
  const nomes = mapa.map((alvo) => alvo.tabela);

  // As duas tabelas vivas que não existem em db/schema.ts. Uma lista derivada do arquivo
  // de schema deixaria linha órfã nas duas, para sempre.
  assert.ok(nomes.includes("audit_events"), "audit_events entra sozinha");
  assert.ok(nomes.includes("organization_members"), "organization_members entra sozinha");

  // A filha que não tem a coluna: entra pela mãe, por subconsulta.
  const itens = mapa.find((alvo) => alvo.tabela === "budget_items");
  assert.ok(itens, "budget_items entra");
  assert.equal(itens.onde, "mae");
  assert.equal(itens.via.mae, "budget_versions");

  // O que não pertence a empresa nenhuma fica de fora.
  for (const fora of ["organizations", "users", "user_credentials", "_platform_migrations", "platform_deletions"]) {
    assert.ok(!nomes.includes(fora), `${fora} não deve ser apagada junto`);
  }
});

test("a filha vem antes da mãe, senão a chave estrangeira recusa", async () => {
  const nomes = (await apagar.mapaDaExclusao(db)).map((alvo) => alvo.tabela);
  const antes = (filha, mae) => assert.ok(
    nomes.indexOf(filha) < nomes.indexOf(mae),
    `${filha} precisa ser apagada antes de ${mae}`,
  );
  antes("tasks", "projects");
  antes("projects", "clients");
  antes("budget_items", "budget_versions");
  antes("diary_revisions", "site_diary_entries");
});

test("apagar a empresa leva tudo, e não encosta na empresa do lado", async () => {
  await semear("org-a", "a");
  await semear("org-b", "b");

  const instrucoes = await apagar.instrucoesParaApagarEmpresa(db, "org-a");
  // Transacional de propósito: meia empresa apagada é pior do que nenhuma, porque
  // ninguém sabe o que sobrou.
  await db.batch(instrucoes);

  assert.equal(await contar("organizations", "id", "org-a"), 0);
  for (const tabela of ["clients", "projects", "tasks", "budget_versions", "audit_events", "worksheets"]) {
    assert.equal(await contar(tabela, "organization_id", "org-a"), 0, `sobrou linha em ${tabela}`);
  }
  assert.equal(await contar("budget_items", "id", "bi-a"), 0, "o item de orçamento sobreviveu à exclusão");

  // A empresa vizinha fica intacta — o filtro é por organização, não um "limpar tudo".
  assert.equal(await contar("organizations", "id", "org-b"), 1);
  for (const tabela of ["clients", "projects", "tasks", "budget_versions", "audit_events", "worksheets"]) {
    assert.equal(await contar(tabela, "organization_id", "org-b"), 1, `${tabela} da outra empresa foi afetada`);
  }
  assert.equal(await contar("budget_items", "id", "bi-b"), 1);
});

test("quem fica sem empresa nenhuma é apagado; quem tem outra, não", async () => {
  await semear("org-c", "c");
  await semear("org-d", "d");
  // `so-c` existe apenas na empresa que vai sair. `nos-dois` também está na outra.
  await vincular("so-c", "so@c.com", "org-c", "c1");
  await vincular("nos-dois", "dois@x.com", "org-c", "c2");
  await vincular("nos-dois", "dois@x.com", "org-d", "d2");

  const orfas = await apagar.contasQueFicamSemEmpresa(db, "org-c");
  assert.deepEqual(orfas, ["so-c"], "só quem ficaria sem nenhuma empresa");

  await db.batch([
    ...(await apagar.instrucoesParaApagarEmpresa(db, "org-c")),
    ...apagar.instrucoesParaApagarContas(db, orfas),
  ]);

  // O login sai junto: conta sem empresa nenhuma entra e vê uma tela vazia, sem saber se
  // perdeu acesso ou se o produto quebrou.
  assert.equal(await contar("users", "id", "so-c"), 0);
  assert.equal(await contar("user_credentials", "user_id", "so-c"), 0);

  // Quem também é membro de outra empresa perde só este vínculo.
  assert.equal(await contar("users", "id", "nos-dois"), 1);
  assert.equal(await contar("user_credentials", "user_id", "nos-dois"), 1);
  assert.equal(await contar("organization_members", "user_id", "nos-dois"), 1);
  assert.equal(await contar("members", "external_user_id", "nos-dois"), 1);
});

test("o registro da exclusão sobrevive à exclusão", async () => {
  /**
   * `platform_audit_events` exige `organization_id` com chave estrangeira. O registro de
   * "esta empresa foi apagada" não teria para onde apontar — e sairia junto no cascade.
   * A ação mais destrutiva do produto seria a única sem rastro.
   */
  const { registrarExclusao } = await vite.ssrLoadModule("/lib/server/exclusoes.ts");
  await semear("org-e", "e");
  await db.batch([
    ...(await apagar.instrucoesParaApagarEmpresa(db, "org-e")),
    registrarExclusao(db, { tipo: "organization", subjectId: "org-e", rotulo: "Empresa e", actor: "admin@x.com", detalhes: { slug: "empresa-e" } }),
  ]);

  assert.equal(await contar("organizations", "id", "org-e"), 0);
  const registro = await db.prepare("SELECT tipo, rotulo, actor FROM platform_deletions WHERE subject_id = ?1").bind("org-e").first();
  assert.equal(registro.tipo, "organization");
  // O nome legível, não só o UUID: seis meses depois ninguém responde "qual empresa era
  // essa?" olhando um identificador.
  assert.equal(registro.rotulo, "Empresa e");
  assert.equal(registro.actor, "admin@x.com");
});

test("a exclusão da empresa fala com a Drap antes de apagar daqui", async () => {
  /**
   * A conexão guardada aqui é a única coisa que sabe qual empresa lá corresponde a esta.
   * Apagando daqui primeiro, essa ligação some: a empresa fica viva na Drap sem ninguém
   * que saiba o que ela era, e o documento dela continua ocupado.
   */
  const rota = await readFile(`${root}/app/api/superadmin/organizations/[organizationId]/route.ts`, "utf8");
  const semComentarios = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(
    semComentarios.indexOf("apagarEmpresaNaDrap(") < semComentarios.indexOf("instrucoesParaApagarEmpresa("),
    "a Drap vem primeiro",
  );
  // Recusa de lá para tudo: seguir em frente apagaria o vínculo e deixaria a empresa
  // órfã na Drap para sempre.
  assert.match(rota, /drap_recusou_exclusao/);
  // E existe a saída explícita, que fica escrita no registro.
  assert.match(rota, /manterNaDrap/);
  assert.match(rota, /empresaRemotaApagada \? "apagada" : "mantida"/);
});

test("convite que ainda abre não some da lista", async () => {
  // Apagar a linha sem revogar deixaria o link vivo e invisível: um acesso que ninguém
  // mais consegue ver para cancelar.
  const rota = await readFile(`${root}/app/api/superadmin/invitations/[invitationId]/route.ts`, "utf8");
  assert.match(rota, /invitation_still_valid/);
  assert.match(rota, /const aindaVale = !invitation\.accepted_at && !invitation\.revoked_at && invitation\.expires_at > Date\.now\(\)/);
});

test("o superadministrador não apaga a própria conta", async () => {
  const rota = await readFile(`${root}/app/api/superadmin/accounts/[userId]/route.ts`, "utf8");
  assert.match(rota, /account_self_delete/);
  // E apagar conta não apaga o trabalho: tarefa, diário e orçamento são da empresa.
  const semComentarios = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(semComentarios, /DELETE FROM tasks|DELETE FROM site_diary_entries|DELETE FROM projects/);
});
