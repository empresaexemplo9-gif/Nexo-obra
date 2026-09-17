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
  // Nenhum segredo pode viajar em variável pública — de qualquer provedor, não só da Drap.
  //
  // Antes esta linha barrava qualquer `NEXT_PUBLIC_*` que citasse DRAP, o que é mais largo
  // do que a regra 4 do CLAUDE.md: ela proíbe expor TOKEN, não proíbe endereço público. O
  // portal da Drap é um link que o navegador precisa conhecer para abrir. Barrá-lo não
  // protegia nada e bloqueava uso legítimo; conferir o sufixo do nome protege mais, porque
  // vale para todo provedor.
  const publicasComSegredo = [...env.matchAll(/^NEXT_PUBLIC_[A-Z0-9_]+/gm)]
    .map(([nome]) => nome)
    .filter((nome) => /(TOKEN|SECRET|KEY|PASSWORD|HASH|CREDENTIAL)$/.test(nome));
  assert.deepEqual(publicasComSegredo, [], `variável pública com nome de segredo: ${publicasComSegredo.join(", ")}`);
  assert.match(adapter, /Authorization/);
  // O segredo vem do ambiente resolvido no servidor, nunca do navegador. O nome do
  // provedor não faz parte do contrato: antes era cloudflare:workers, hoje é process.env.
  assert.match(adapter, /@\/lib\/server\/runtime/);
  assert.doesNotMatch(adapter, /"use client"/);
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

test("uses the supplied H.OIKOS brand across the product", async () => {
  const app = await source("components/nexo-app.tsx");
  const layout = await source("app/layout.tsx");
  const brand = await source("components/brand-logo.tsx");
  assert.match(app, /BrandLogo/);
  assert.match(layout, /H\.OIKOS/);
  // O manual exige 150 px de largura mínima para o logotipo em uso digital.
  assert.match(brand, /minWidth: 150/);
  for (const screen of ["nexo-app", "project-hub", "superadmin-app", "maintenance-login", "invitation-app", "client-portal-app", "terms-page"]) {
    const ui = await source(`components/${screen}.tsx`);
    assert.match(ui, /BrandLogo/);
    assert.doesNotMatch(ui, /drap-architector-logo|Drap Architector/);
  }
  for (const variant of ["wordmark", "stacked", "symbol", "signature", "lockup"]) {
    for (const tone of ["light", "dark"]) {
      const svg = await source(`public/brand/hoikos-${variant}-${tone}.svg`);
      assert.match(svg, /viewBox=/);
      assert.match(svg, /<path /);
      assert.doesNotMatch(svg, /<text|<script|<image|filter=/);
      assert.match(svg, tone === "light" ? /#38301B/ : /#F7F7F0/);
    }
  }
  await assert.rejects(source("public/drap-architector-logo.png"));
});

test("serves the brand typography from the product itself", async () => {
  const css = await source("app/globals.css");
  const layout = await source("app/layout.tsx");
  // As duas famílias do manual (sans geométrica e serifada fina) vêm do próprio domínio.
  assert.match(css, /font-family: "Hoikos Sans"/);
  assert.match(css, /font-family: "Hoikos Display"/);
  assert.match(css, /--font-display:/);
  assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com|@import url\(/);
  assert.match(layout, /rel="preload"[^>]*fonts\//);
  for (const file of ["jost-latin.woff2", "jost-latin-ext.woff2", "cormorant-latin.woff2", "cormorant-latin-ext.woff2"]) {
    await source(`public/fonts/${file}`);
  }
});

test("uses only the H.OIKOS master palette in the theme", async () => {
  const css = await source("app/globals.css");
  assert.deepEqual([...new Set(css.match(/#[0-9a-f]{6}/gi))].sort(), ["#000000", "#38301B", "#B5B19E", "#F7F7F0"].sort());
  assert.doesNotMatch(css, /gradient\(|blueprint-grid/);
  for (const screen of ["nexo-app", "project-hub", "superadmin-app", "maintenance-login", "invitation-app", "client-portal-app", "terms-page", "budgets-workspace", "finance-workspace", "diary-workspace", "platform-control", "portal-manager", "portal-shared", "team-access-manager"]) {
    assert.doesNotMatch(await source(`components/${screen}.tsx`), /(?:bg|text|border|ring)-(?:blue|cyan|slate|emerald|amber|red)-\d|gradient\(/);
  }
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

test("gives the superadmin full power over any company, under audit", async () => {
  const overview = await source("app/api/superadmin/overview/route.ts");
  const backend = await source("lib/server/backend.ts");
  const ui = await source("components/superadmin-app.tsx");
  const terms = await source("components/terms-page.tsx");

  // O painel continua agregado: o conteúdo da empresa é lido no contexto dela, não aqui.
  assert.doesNotMatch(overview, /c\.name|p\.name|t\.title|budget_cents|financial/);
  assert.match(backend, /identity\.scope === "superadmin"/);
  assert.match(backend, /platform\.superadmin_entered/);
  assert.match(ui, /leitura e edição totais/);
  assert.match(terms, /leitura e edição em todos os módulos/);
});

test("provides an isolated maintenance administrator without storing its password", async () => {
  const auth = await source("lib/server/maintenance.ts");
  const session = await source("app/api/maintenance/session/route.ts");
  const backend = await source("lib/server/backend.ts");
  const login = await source("components/maintenance-login.tsx");

  assert.match(auth, /MAINTENANCE_ADMIN_PASSWORD_HASH/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(auth, /Ambiente de manutenção/);
  assert.match(session, /maintenanceOrganizationStatement/);
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

test("provides real multi-tenant budget versions, items and company catalog", async () => {
  const schema = await source("db/schema.ts");
  const budgets = await source("app/api/budgets/route.ts");
  const items = await source("app/api/budgets/[budgetId]/items/route.ts");
  const catalog = await source("app/api/budget-library/route.ts");

  assert.match(schema, /sqliteTable\("budget_catalog_items"/);
  assert.match(schema, /uidx_budget_catalog_org_source_code/);
  for (const route of [budgets, items, catalog]) {
    assert.match(route, /requireOrganizationContext/);
    assert.match(route, /requireModulePermission\(context, "budgets"/);
  }
  assert.match(items, /Math\.round\(item\.unitCostCents \* factor\)/);
  assert.match(items, /MAX\(sort_order\)/);
  assert.match(items, /budget\.items_added/);
});

test("supports bulk budgeting and an official-only SINAPI adapter", async () => {
  const ui = await source("components/budgets-workspace.tsx");
  const adapter = await source("lib/integrations/sinapi.ts");
  const route = await source("app/api/integrations/sinapi/items/route.ts");

  assert.match(ui, /Importar itens em lote/);
  assert.match(ui, /Biblioteca da empresa/);
  assert.match(ui, /Buscar na SINAPI/);
  assert.match(adapter, /SINAPI_API_TOKEN/);
  assert.match(adapter, /Authorization/);
  assert.match(route, /sinapi_not_configured/);
  assert.doesNotMatch(`${ui}\n${adapter}\n${route}`, /demoSinapi|mockSinapi|SINAPI_DEMO/i);
});

test("integrates finance with each project through tenant-owned Drap links", async () => {
  const ui = await source("components/finance-workspace.tsx");
  const transactions = await source("app/api/integrations/drap/transactions/route.ts");
  const projectLink = await source("app/api/integrations/drap/project-link/route.ts");
  const connection = await source("app/api/integrations/drap/connection/route.ts");

  assert.match(ui, /Contas a pagar e receber/);
  assert.match(ui, /Relatório personalizado/);
  assert.match(ui, /Lembretes automáticos/);
  for (const route of [transactions, projectLink, connection]) {
    assert.match(route, /requireOrganizationContext/);
    assert.match(route, /requireModulePermission\(context, "finance"/);
  }
  assert.match(transactions, /external_financial_cost_center_id/);
  assert.match(projectLink, /organization_id = \?2|organization_id = \?3/);
});

test("creates remote charges only with idempotency and confirmed Drap output", async () => {
  const schema = await source("db/schema.ts");
  const charges = await source("app/api/integrations/drap/charges/route.ts");
  const adapter = await source("lib/integrations/drap.ts");

  assert.match(schema, /sqliteTable\("financial_charge_requests"/);
  assert.match(schema, /uidx_financial_charge_org_idempotency/);
  assert.match(charges, /isDrapChargesConfigured/);
  assert.match(charges, /idempotencyKey: z\.string\(\)\.uuid\(\)/);
  assert.match(charges, /requireActiveDrapConnection/);
  assert.match(adapter, /Idempotency-Key/);

  // A política de lembrete é da H.OIKOS e fica na H.OIKOS: a cobrança da Drap
  // não tem esse campo. Enquanto o contrato era suposição, o adaptador mandava
  // `reminder_policy` no corpo — campo que o outro lado ignora, e que faria o
  // contrato divergir em silêncio. Quem guarda o prazo é a coluna local.
  assert.match(charges, /reminder_policy_json/);
  assert.doesNotMatch(adapter, /reminder_policy/);

  // O valor viaja em reais, que é como a Drap trabalha. Mandar centavos
  // cobraria cem vezes mais, sem erro nenhum no caminho.
  assert.match(adapter, /amountCents \/ 100/);
  assert.match(adapter, /parceiro_id/);

  assert.doesNotMatch(`${charges}\n${adapter}`, /demoCharge|mockCharge|fakeCharge/);
});
