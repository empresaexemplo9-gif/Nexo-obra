import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function source(path) {
  return readFile(`${root}/${path}`, "utf8");
}

test("keeps every requested workspace in the product shell", async () => {
  const app = await source("components/nexo-app.tsx");
  for (const label of [
    "Projetos",
    "Obras",
    "Orçamentos",
    "Cronograma",
    "Clientes",
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

test("resolves identity and organization only on the server", async () => {
  const backend = await source("lib/server/backend.ts");
  const projectsApi = await source("app/api/projects/route.ts");

  assert.match(backend, /oai-authenticated-user-id/);
  assert.match(backend, /members m/);
  assert.match(backend, /m\.organization_id/);
  assert.doesNotMatch(projectsApi, /x-organization-id/);
  assert.match(projectsApi, /requireOrganizationContext/);
});

test("provides audited CRUD routes for the operational core", async () => {
  for (const route of [
    "app/api/clients/route.ts",
    "app/api/clients/[clientId]/route.ts",
    "app/api/projects/route.ts",
    "app/api/projects/[projectId]/route.ts",
    "app/api/tasks/route.ts",
    "app/api/tasks/[taskId]/route.ts",
  ]) {
    const api = await source(route);
    assert.match(api, /requireOrganizationContext/);
  }

  const backend = await source("lib/server/backend.ts");
  assert.match(backend, /INSERT INTO audit_events/);
});

test("removes the obsolete password-session backend", async () => {
  for (const path of [
    "lib/auth.ts",
    "pages/api/access-login.ts",
    "pages/api/admin-login.ts",
    "pages/api/logout.ts",
    "pages/api/session.ts",
  ]) {
    await assert.rejects(source(path));
  }
});

test("ships no fabricated product or financial data", async () => {
  const app = await source("components/nexo-app.tsx");
  const finance = await source("app/api/integrations/drap/summary/route.ts");

  await assert.rejects(source("lib/demo-data.ts"));
  assert.doesNotMatch(app, /demo-data|Residência Aurora|Clínica Átrio/);
  assert.doesNotMatch(finance, /demoFinancialSummary|demo-company/);
  assert.match(finance, /integration_not_configured/);
});

test("supports verified organization selection", async () => {
  const backend = await source("lib/server/backend.ts");
  const session = await source("app/api/session/route.ts");
  const onboarding = await source("app/api/onboarding/route.ts");

  assert.match(backend, /__Host-nexo-organization/);
  assert.match(session, /membership\.organization_id === parsed\.data\.organizationId/);
  assert.match(onboarding, /organizationSelectionCookie/);
});

test("uses the supplied Drap Architector brand", async () => {
  const app = await source("components/nexo-app.tsx");
  const layout = await source("app/layout.tsx");

  assert.match(app, /\/drap-architector-logo\.png/);
  assert.match(layout, /Drap Architector/);
});

test("keeps superadmin credentials and authorization on the server", async () => {
  const auth = await source("lib/server/superadmin.ts");
  const session = await source("app/api/superadmin/session/route.ts");
  const overview = await source("app/api/superadmin/overview/route.ts");
  const ui = await source("components/superadmin-app.tsx");

  assert.match(auth, /SUPERADMIN_PASSWORD_HASH/);
  assert.match(auth, /SUPERADMIN_EMAIL/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(session, /superadmin_login_attempts/);
  assert.match(overview, /requireSuperAdmin/);
  assert.match(await source("components/nexo-app.tsx"), /initial-superadmin-email/);
  assert.doesNotMatch(`${auth}\n${session}\n${overview}\n${ui}`, /147532159/);
});

test("creates single-use organization access from protected invitation links", async () => {
  const schema = await source("db/schema.ts");
  const adminInvites = await source("app/api/superadmin/invitations/route.ts");
  const acceptInvite = await source("app/api/invitations/[token]/accept/route.ts");
  const invitePage = await source("components/invitation-app.tsx");

  assert.match(schema, /sqliteTable\("organization_invitations"/);
  assert.match(adminInvites, /requireSuperAdmin/);
  assert.match(adminInvites, /invitationTokenHash/);
  assert.match(acceptInvite, /authenticatedIdentity/);
  assert.match(acceptInvite, /invitation_email_mismatch/);
  assert.match(acceptInvite, /organizationSelectionCookie/);
  assert.match(invitePage, /Aceitar e criar acesso/);
});

test("lets only the current company manage scoped secondary access", async () => {
  const permissions = await source("lib/permissions.ts");
  const invitations = await source("app/api/organization-invitations/route.ts");
  const revocation = await source("app/api/organization-invitations/[invitationId]/route.ts");
  const backend = await source("lib/server/backend.ts");

  for (const profile of ["partner", "service_provider", "finance", "accounting"]) {
    assert.match(invitations, new RegExp(profile));
  }
  assert.match(permissions, /PermissionSet/);
  assert.match(invitations, /context\.organization\.id/);
  assert.match(invitations, /canManageOrganizationAccess/);
  assert.match(revocation, /organization_id = \?2/);
  assert.match(backend, /module_permission_denied/);
});

test("records versioned terms before tenant data access", async () => {
  const schema = await source("db/schema.ts");
  const backend = await source("lib/server/backend.ts");
  const acceptance = await source("app/api/terms/accept/route.ts");
  const invitationAcceptance = await source("app/api/invitations/[token]/accept/route.ts");
  const terms = await source("components/terms-page.tsx");

  assert.match(schema, /sqliteTable\("terms_acceptances"/);
  assert.match(backend, /terms_acceptance_required/);
  assert.match(acceptance, /CURRENT_TERMS_VERSION/);
  assert.match(invitationAcceptance, /acceptTerms/);
  assert.match(terms, /Superadmin e separação dos dados/);
});

test("keeps the superadmin overview out of tenant content", async () => {
  const overview = await source("app/api/superadmin/overview/route.ts");
  const ui = await source("components/superadmin-app.tsx");

  assert.doesNotMatch(overview, /c\.name|p\.name|t\.title|budget_cents|financial/);
  assert.match(ui, /conteúdo confidencial de cada empresa não é exibido/);
});

test("provides an isolated maintenance administrator without storing its password", async () => {
  const auth = await source("lib/server/maintenance.ts");
  const session = await source("app/api/maintenance/session/route.ts");
  const backend = await source("lib/server/backend.ts");
  const login = await source("components/maintenance-login.tsx");

  assert.match(auth, /MAINTENANCE_ADMIN_PASSWORD_HASH/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(session, /Ambiente de manutenção/);
  assert.match(backend, /MAINTENANCE_ORGANIZATION_ID/);
  assert.match(backend, /identity\.scope === "maintenance"/);
  assert.match(login, /Entrar no ambiente de manutenção/);
  assert.doesNotMatch(`${auth}\n${session}\n${backend}\n${login}`, /147532159/);
});

test("centralizes each project without inventing unfinished module data", async () => {
  const hub = await source("components/project-hub.tsx");
  const page = await source("app/projetos/[projectId]/page.tsx");
  const shell = await source("components/nexo-app.tsx");

  assert.match(page, /ProjectHub/);
  assert.match(shell, /\/projetos\/\$\{project\.id\}/);
  for (const area of ["Planejamento", "Tarefas", "Orçamento", "Financeiro", "Diário de obra", "Compras", "Medições", "Arquivos"]) {
    assert.match(hub, new RegExp(area));
  }
  assert.match(hub, /Próxima conexão/);
  assert.match(hub, /Estes valores são da empresa inteira, não desta obra isoladamente/);
  assert.doesNotMatch(hub, /Residência Aurora|Clínica Átrio|demo-data/);
});

test("redacts project client, budget and finance fields by module permission", async () => {
  const projects = await source("app/api/projects/route.ts");
  const project = await source("app/api/projects/[projectId]/route.ts");

  assert.match(projects, /includeClient: context\.member\.permissions\.crm\.view/);
  assert.match(projects, /includeBudget: context\.member\.permissions\.budgets\.view/);
  assert.match(projects, /includeFinance: context\.member\.permissions\.finance\.view/);
  assert.match(project, /visibleProject/);
});
