import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return readFile(`${root}/${path}`, "utf8");
}

/**
 * Remove comentários antes de asserções de "isto não pode existir".
 *
 * Um comentário que explica por que o header `x-organization-id` foi removido é
 * documentação útil, não uma reintrodução. A guarda precisa olhar o código.
 */
function stripComments(contents) {
  return contents.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

test("keeps every requested workspace in the product shell", async () => {
  const app = await source("components/nexo-app.tsx");
  for (const label of [
    "Projetos",
    "Obras",
    "Orçamentos",
    "Cronograma",
    "Vendas e clientes",
    "Financeiro",
    "Equipe",
    "Tarefas",
    "Arquivos",
  ]) {
    assert.match(app, new RegExp(label));
  }
});

test("keeps the Drap secret behind a server route", async () => {
  const app = await source("components/nexo-app.tsx");
  const env = await source(".env.example");
  const adapter = await source("lib/integrations/drap.ts");

  assert.doesNotMatch(app, /DRAP_API_TOKEN/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_.*DRAP/);
  assert.match(adapter, /Authorization/);
  assert.match(adapter, /cloudflare:workers/);
});

test("models operational records with organization ownership", async () => {
  const schema = await source("db/schema.ts");
  for (const table of [
    "clients",
    "projects",
    "tasks",
    "budget_versions",
    "crm_opportunities",
    "project_files",
    "integration_events",
  ]) {
    assert.match(schema, new RegExp(`sqliteTable\\(\"${table}\"`));
  }
  assert.match(schema, /organizationId: text\("organization_id"\)/);
});

test("resolve a organização no servidor, sem header informado pelo cliente", async () => {
  // Guarda de regressão da Fase 1: o header `x-organization-id` deixava o
  // cliente escolher a empresa. Se ele voltar a qualquer rota, este teste falha.
  const routes = [
    "app/api/projects/route.ts",
    "app/api/projects/[id]/route.ts",
    "app/api/clients/route.ts",
    "app/api/clients/[id]/route.ts",
    "app/api/tasks/route.ts",
    "app/api/tasks/[id]/route.ts",
  ];

  for (const route of routes) {
    const contents = await source(route);
    assert.doesNotMatch(
      stripComments(contents),
      /x-organization-id/i,
      `${route} não pode ler a empresa do cliente`,
    );
    assert.match(contents, /requireAuth\(\)/, `${route} deve resolver a empresa pela sessão`);
    assert.match(contents, /assertCan\(/, `${route} deve checar permissão no servidor`);
  }
});

test("toda consulta do núcleo recebe a organização como parâmetro", async () => {
  for (const modulePath of ["lib/data/clients.ts", "lib/data/projects.ts", "lib/data/tasks.ts"]) {
    const contents = await source(modulePath);
    assert.match(
      contents,
      /organizationId: string/,
      `${modulePath} deve exigir organizationId nas funções de consulta`,
    );
  }
});

test("o cookie de empresa ativa é apenas preferência, reconferida no servidor", async () => {
  const session = await source("lib/auth/session.ts");

  // O cookie não concede acesso: a empresa ativa sai da interseção com as
  // associações reais carregadas do banco.
  assert.match(session, /memberships\.find\(/);
  assert.match(session, /eq\(members\.externalUserId, identity\.subject\)/);
});
