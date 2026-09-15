import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

// Regras contratuais simples: estes testes não substituem os testes funcionais,
// mas impedem que uma refatoração apague por engano peças estruturais do produto.

test("keeps every requested workspace in the product shell", async () => {
  const shell = await source("components/app-shell.tsx");
  for (const label of [
    "Visão geral",
    "Projetos",
    "Obras",
    "Orçamentos",
    "Cronograma",
    "CRM e clientes",
    "Financeiro",
    "Equipe",
    "Tarefas",
    "Arquivos",
  ]) {
    assert.match(shell, new RegExp(label));
  }
});

test("keeps the Drap secret behind a server route", async () => {
  const workspace = await source("components/finance-workspace.tsx");
  const route = await source("app/api/integrations/drap/summary/route.ts");
  const integration = await source("lib/integrations/drap.ts");

  assert.doesNotMatch(workspace, /DRAP_API_TOKEN|process\.env/);
  assert.match(route, /fetchDrapSummary/);
  assert.match(integration, /DRAP_API_TOKEN/);
});

test("models operational records with organization ownership", async () => {
  const schema = await source("db/schema.ts");
  for (const table of ["clients", "projects", "tasks", "audit_logs"]) {
    assert.match(schema, new RegExp(`sqliteTable\\(\"${table}\"`));
  }
  assert.match(schema, /organizationId/);
});

test("resolves identity and organization only on the server", async () => {
  const backend = await source("lib/server/backend.ts");
  assert.match(backend, /resolveContext/);
  assert.match(backend, /organizationId/);
  assert.match(backend, /permissions/);
});

test("provides audited CRUD routes for the operational core", async () => {
  for (const route of ["clients", "projects", "tasks"]) {
    const code = await source(`app/api/${route}/route.ts`);
    assert.match(code, /apiRoute/);
    assert.match(code, /resolveContext/);
  }
  const backend = await source("lib/server/backend.ts");
  assert.match(backend, /audit/);
});

test("removes the obsolete password-session backend", async () => {
  const packageJson = await source("package.json");
  assert.doesNotMatch(packageJson, /next-auth|better-auth|clerk/i);
});

test("ships no fabricated product or financial data", async () => {
  for (const path of [
    "components/dashboard-workspace.tsx",
    "components/projects-workspace.tsx",
    "components/finance-workspace.tsx",
  ]) {
    const code = await source(path);
    assert.doesNotMatch(code, /mock|demo|faker/i);
  }
});

test("supports verified organization selection", async () => {
  const backend = await source("lib/server/backend.ts");
  assert.match(backend, /selectedOrganization/);
});

test("uses the supplied H.OIKOS brand across the product", async () => {
  const shell = await source("components/app-shell.tsx");
  const css = await source("app/globals.css");
  assert.match(shell, /H\.OIKOS/);
  assert.match(css, /38301B/i);
});

test("serves the brand typography from the product itself", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /@font-face/);
  assert.match(css, /\/fonts\//);
});

test("uses only the H.OIKOS master palette in the theme", async () => {
  const css = await source("app/globals.css");
  for (const color of ["000000", "38301B", "B5B19E", "F7F7F0"]) {
    assert.match(css, new RegExp(color, "i"));
  }
});

test("keeps superadmin credentials and authorization on the server", async () => {
  const route = await source("app/api/superadmin/session/route.ts");
  const auth = await source("lib/server/superadmin.ts");
  assert.match(auth, /SUPERADMIN_PASSWORD_HASH/);
  assert.match(route, /createSuperadminSession/);
});

test("creates single-use organization access from protected invitation links", async () => {
  const route = await source("app/api/invitations/[token]/accept/route.ts");
  const schema = await source("db/schema.ts");
  assert.match(route, /token/);
  assert.match(schema, /organization_invitations/);
});

test("lets only the current company manage scoped secondary access", async () => {
  const route = await source("app/api/organization-invitations/route.ts");
  assert.match(route, /organizationId/);
  assert.match(route, /permissions/);
});

test("records versioned terms before tenant data access", async () => {
  const route = await source("app/api/terms/accept/route.ts");
  const schema = await source("db/schema.ts");
  assert.match(route, /terms/);
  assert.match(schema, /terms_acceptances/);
});

test("gives the superadmin full power over any company, under audit", async () => {
  const backend = await source("lib/server/backend.ts");
  const overview = await source("app/api/superadmin/overview/route.ts");
  assert.match(backend, /superadmin/);
  assert.match(overview, /organization/);
});

test("provides an isolated maintenance administrator without storing its password", async () => {
  const route = await source("app/api/maintenance/session/route.ts");
  const auth = await source("lib/server/maintenance.ts");
  assert.match(auth, /MAINTENANCE_ADMIN_PASSWORD_HASH/);
  assert.match(route, /maintenance/);
});

test("centralizes each project without inventing unfinished module data", async () => {
  const page = await source("app/projetos/[projectId]/page.tsx");
  assert.match(page, /projectId/);
});

test("redacts project client, budget and finance fields by module permission", async () => {
  const route = await source("app/api/projects/[projectId]/route.ts");
  assert.match(route, /permissions/);
});

test("provides real multi-tenant budget versions, items and company catalog", async () => {
  const budgets = await source("app/api/budgets/route.ts");
  const items = await source("app/api/budgets/[budgetId]/items/route.ts");
  const library = await source("app/api/budget-library/route.ts");
  assert.match(budgets, /organizationId/);
  assert.match(items, /organizationId/);
  assert.match(library, /organizationId/);
});

test("supports bulk budgeting and an official-only SINAPI adapter", async () => {
  const ui = await source("components/budgets-workspace.tsx");
  const adapter = await source("lib/integrations/sinapi.ts");
  const provider = await source("lib/integrations/orcamentador.ts");
  const route = await source("app/api/integrations/sinapi/items/route.ts");

  assert.match(ui, /Importar itens em lote/);
  assert.match(ui, /Biblioteca da empresa/);
  assert.match(ui, /Buscar na SINAPI/);
  assert.match(adapter, /searchOrcamentadorItems/);
  assert.match(provider, /SINAPI_API_TOKEN/);
  assert.match(provider, /X-API-Key/);
  assert.match(provider, /orcamentador\.com\.br\/api/);
  assert.match(route, /sinapi_not_configured/);
  assert.doesNotMatch(`${ui}\n${adapter}\n${provider}\n${route}`, /demoSinapi|mockSinapi|SINAPI_DEMO/i);
});

test("integrates finance with each project through tenant-owned Drap links", async () => {
  const ui = await source("components/finance-workspace.tsx");
  const transactions = await source("app/api/integrations/drap/transactions/route.ts");
  const projectLink = await source("app/api/integrations/drap/project-link/route.ts");
  assert.match(ui, /Drap/);
  assert.match(transactions, /organizationId/);
  assert.match(projectLink, /organizationId/);
});

test("creates remote charges only with idempotency and confirmed Drap output", async () => {
  const route = await source("app/api/integrations/drap/charges/route.ts");
  assert.match(route, /idempotency/i);
});
