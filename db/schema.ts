import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  ...timestamps,
}, (table) => [uniqueIndex("uidx_organizations_slug").on(table.slug)]);

export const platformAccessRules = sqliteTable("platform_access_rules", {
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  subject: text("subject").notNull(), // '*' means the company; otherwise a normalized email.
  state: text("state").notNull(),
  until: integer("until"),
  reason: text("reason").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("uidx_platform_access_subject").on(t.organizationId, t.subject)]);

export const drapActivations = sqliteTable("drap_activations", {
  organizationId: text("organization_id").primaryKey().references(() => organizations.id),
  companyId: text("company_id").notNull(),
  planId: text("plan_id").notNull(),
  requestKey: text("request_key").notNull(),
  status: text("status").notNull().default("pending"),
  subscriptionId: text("subscription_id"),
  baseCents: integer("base_cents"),
  monthlyCents: integer("monthly_cents"),
  remoteRevision: integer("remote_revision").notNull().default(0),
  lastRequestedAt: integer("last_requested_at").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("uidx_drap_activation_company").on(t.companyId), uniqueIndex("uidx_drap_activation_request").on(t.requestKey), uniqueIndex("uidx_drap_activation_subscription").on(t.subscriptionId)]);

export const drapActivationEvents = sqliteTable("drap_activation_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  digest: text("digest").notNull(),
  receivedAt: integer("received_at").notNull(),
});

// Administrators and service actors are not tenant members or customer users.
export const platformAuditEvents = sqliteTable("platform_audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadataJson: text("metadata_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("idx_platform_audit_org_created").on(t.organizationId, t.createdAt)]);

/**
 * O que foi apagado da plataforma, e por quem.
 *
 * ─── POR QUE NÃO CABE EM `platform_audit_events` ───
 *
 * Aquela tabela exige `organization_id` com chave estrangeira para `organizations`. Um
 * registro de "esta empresa foi apagada" não tem onde apontar: a empresa deixou de
 * existir no mesmo instante, e a linha de auditoria dela sai junto na exclusão.
 *
 * O resultado seria a ação mais destrutiva do produto sendo também a única sem rastro.
 * Por isso esta tabela não tem chave estrangeira nenhuma, de propósito: o que ela guarda
 * é justamente aquilo que não existe mais. `rotulo` preserva o nome legível, porque um
 * UUID solto não responde "qual empresa era essa?" seis meses depois.
 */
export const platformDeletions = sqliteTable("platform_deletions", {
  id: text("id").primaryKey(),
  /** 'organization', 'account' ou 'invitation'. */
  tipo: text("tipo").notNull(),
  subjectId: text("subject_id").notNull(),
  /** Nome da empresa, e-mail da conta — o que identifica para um humano. */
  rotulo: text("rotulo").notNull(),
  /** Quem mandou apagar. */
  actor: text("actor").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (t) => [index("idx_platform_deletions_created").on(t.createdAt)]);

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  externalUserId: text("external_user_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  permissionsJson: text("permissions_json").notNull().default("{}"),
  weeklyCapacityMinutes: integer("weekly_capacity_minutes").notNull().default(2400),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_members_org_external_user").on(table.organizationId, table.externalUserId),
  index("idx_members_org_active").on(table.organizationId, table.active),
]);

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  document: text("document"),
  email: text("email"),
  phone: text("phone"),
  externalFinancialId: text("external_financial_id"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, (table) => [
  index("idx_clients_org_name").on(table.organizationId, table.name),
  uniqueIndex("uidx_clients_org_external_financial").on(table.organizationId, table.externalFinancialId),
]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  clientId: text("client_id").references(() => clients.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("project"),
  status: text("status").notNull().default("active"),
  phase: text("phase").notNull().default("briefing"),
  progressPercent: integer("progress_percent").notNull().default(0),
  ownerMemberId: text("owner_member_id").references(() => members.id),
  startDate: text("start_date"),
  targetDate: text("target_date"),
  budgetCents: integer("budget_cents").notNull().default(0),
  externalFinancialCostCenterId: text("external_financial_cost_center_id"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_projects_org_code").on(table.organizationId, table.code),
  index("idx_projects_org_status").on(table.organizationId, table.status),
  index("idx_projects_org_kind_status").on(table.organizationId, table.kind, table.status),
  index("idx_projects_client").on(table.clientId),
]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").references(() => projects.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("normal"),
  assigneeMemberId: text("assignee_member_id").references(() => members.id),
  parentTaskId: text("parent_task_id"),
  startsAt: text("starts_at"),
  dueAt: text("due_at"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(0),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  index("idx_tasks_org_status_due").on(table.organizationId, table.status, table.dueAt),
  index("idx_tasks_project_status").on(table.projectId, table.status),
  index("idx_tasks_assignee_status").on(table.assigneeMemberId, table.status),
]);

export const timeEntries = sqliteTable("time_entries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  taskId: text("task_id").references(() => tasks.id),
  projectId: text("project_id").references(() => projects.id),
  memberId: text("member_id").notNull().references(() => members.id),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  minutes: integer("minutes").notNull().default(0),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_time_entries_org_project_started").on(table.organizationId, table.projectId, table.startedAt),
  index("idx_time_entries_member_started").on(table.memberId, table.startedAt),
]);

export const siteDiaryEntries = sqliteTable("site_diary_entries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  entryDate: text("entry_date").notNull(),
  weather: text("weather"),
  workforceCount: integer("workforce_count").notNull().default(0),
  summary: text("summary").notNull(),
  blockers: text("blockers").notNull().default(""),
  authorMemberId: text("author_member_id").references(() => members.id),
  clientSignedAt: text("client_signed_at"),
  revision: integer("revision").notNull().default(1),
  authorName: text("author_name").notNull().default(""),
  occurrenceType: text("occurrence_type").notNull().default("none"),
  ...timestamps,
}, (table) => [
  index("idx_site_diary_project_date").on(table.projectId, table.entryDate),
  index("idx_site_diary_org_date").on(table.organizationId, table.entryDate, table.id),
]);

export const diaryRevisions = sqliteTable("diary_revisions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  entryId: text("entry_id").notNull().references(() => siteDiaryEntries.id),
  revision: integer("revision").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  editorMemberId: text("editor_member_id").references(() => members.id),
  editorName: text("editor_name").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("uidx_diary_revisions_entry_revision").on(table.entryId, table.revision)]);

export const diaryPhotos = sqliteTable("diary_photos", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  entryId: text("entry_id").notNull().references(() => siteDiaryEntries.id),
  slot: integer("slot").notNull(),
  storageKey: text("storage_key").notNull(),
  name: text("name").notNull(),
  caption: text("caption").notNull().default(""),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  uploadedByMemberId: text("uploaded_by_member_id").references(() => members.id),
  uploadedByName: text("uploaded_by_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uidx_diary_photos_entry_slot").on(table.entryId, table.slot),
  uniqueIndex("uidx_diary_photos_storage_key").on(table.storageKey),
]);

export const clientPortalAccess = sqliteTable("client_portal_access", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  externalUserId: text("external_user_id"),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  status: text("status").notNull().default("pending"),
  viewProgress: integer("view_progress", { mode: "boolean" }).notNull().default(true),
  canApprove: integer("can_approve", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(1),
  createdByMemberId: text("created_by_member_id").notNull().references(() => members.id),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_client_portal_access_token").on(table.tokenHash),
  uniqueIndex("uidx_client_portal_access_project_email").on(table.organizationId, table.projectId, table.email),
  index("idx_client_portal_access_identity_status").on(table.externalUserId, table.status),
]);

export const clientPortalAcceptances = sqliteTable("client_portal_acceptances", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  accessId: text("access_id").notNull().references(() => clientPortalAccess.id),
  externalUserId: text("external_user_id").notNull(),
  termsVersion: text("terms_version").notNull(),
  ipHash: text("ip_hash").notNull(),
  userAgentHash: text("user_agent_hash").notNull(),
  acceptedAt: integer("accepted_at").notNull(),
}, (table) => [uniqueIndex("uidx_client_portal_acceptance_version").on(table.accessId, table.externalUserId, table.termsVersion)]);

export const clientPortalItems = sqliteTable("client_portal_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  accessId: text("access_id").notNull().references(() => clientPortalAccess.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  dueDate: text("due_date"),
  sourceDiaryId: text("source_diary_id").references(() => siteDiaryEntries.id),
  sourceDiaryRevision: integer("source_diary_revision"),
  photoIdsJson: text("photo_ids_json").notNull().default("[]"),
  status: text("status").notNull().default("open"),
  createdByMemberId: text("created_by_member_id").notNull().references(() => members.id),
  authorName: text("author_name").notNull(),
  withdrawalReason: text("withdrawal_reason").notNull().default(""),
  withdrawnByName: text("withdrawn_by_name").notNull().default(""),
  ...timestamps,
}, (table) => [
  index("idx_client_portal_items_access_created").on(table.accessId, table.createdAt, table.id),
  index("idx_client_portal_items_org_project").on(table.organizationId, table.projectId, table.createdAt),
]);

export const clientPortalDecisions = sqliteTable("client_portal_decisions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  accessId: text("access_id").notNull().references(() => clientPortalAccess.id),
  itemId: text("item_id").notNull().references(() => clientPortalItems.id),
  choice: text("choice").notNull(),
  comment: text("comment").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  actorName: text("actor_name").notNull(),
  actorEmail: text("actor_email").notNull(),
  ipHash: text("ip_hash").notNull(),
  userAgentHash: text("user_agent_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("uidx_client_portal_decision_item").on(table.itemId)]);

export const budgetVersions = sqliteTable("budget_versions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").references(() => projects.id),
  code: text("code").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  directCostCents: integer("direct_cost_cents").notNull().default(0),
  bdiPercent: real("bdi_percent").notNull().default(0),
  marginPercent: real("margin_percent").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  sentAt: text("sent_at"),
  approvedAt: text("approved_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_budget_versions_org_code_version").on(table.organizationId, table.code, table.version),
  index("idx_budget_versions_project_status").on(table.projectId, table.status),
]);

export const budgetItems = sqliteTable("budget_items", {
  id: text("id").primaryKey(),
  budgetVersionId: text("budget_version_id").notNull().references(() => budgetVersions.id),
  parentItemId: text("parent_item_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  code: text("code"),
  description: text("description").notNull(),
  unit: text("unit").notNull().default("un"),
  quantity: real("quantity").notNull().default(1),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  unitPriceCents: integer("unit_price_cents").notNull().default(0),
  source: text("source").notNull().default("manual"),
  sourceReference: text("source_reference"),
}, (table) => [index("idx_budget_items_version_order").on(table.budgetVersionId, table.sortOrder)]);

export const budgetCatalogItems = sqliteTable("budget_catalog_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("Geral"),
  unit: text("unit").notNull().default("un"),
  unitCostCents: integer("unit_cost_cents").notNull().default(0),
  defaultUnitPriceCents: integer("default_unit_price_cents"),
  source: text("source").notNull().default("manual"),
  sourceReference: text("source_reference"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_budget_catalog_org_source_code").on(table.organizationId, table.source, table.code),
  index("idx_budget_catalog_org_category").on(table.organizationId, table.category),
  index("idx_budget_catalog_org_description").on(table.organizationId, table.description),
]);

export const crmOpportunities = sqliteTable("crm_opportunities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  clientId: text("client_id").references(() => clients.id),
  title: text("title").notNull(),
  stage: text("stage").notNull().default("new"),
  estimatedValueCents: integer("estimated_value_cents").notNull().default(0),
  probabilityPercent: integer("probability_percent").notNull().default(0),
  ownerMemberId: text("owner_member_id").references(() => members.id),
  nextAction: text("next_action"),
  nextActionAt: text("next_action_at"),
  wonProjectId: text("won_project_id").references(() => projects.id),
  lostReason: text("lost_reason"),
  ...timestamps,
}, (table) => [
  index("idx_crm_org_stage").on(table.organizationId, table.stage),
  index("idx_crm_org_next_action").on(table.organizationId, table.nextActionAt),
]);

export const projectFiles = sqliteTable("project_files", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").references(() => projects.id),
  storageKey: text("storage_key").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  version: integer("version").notNull().default(1),
  uploadedByMemberId: text("uploaded_by_member_id").references(() => members.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uidx_project_files_storage_key").on(table.storageKey),
  index("idx_project_files_org_project").on(table.organizationId, table.projectId),
]);

export const integrationConnections = sqliteTable("integration_connections", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  provider: text("provider").notNull(),
  externalCompanyId: text("external_company_id").notNull(),
  status: text("status").notNull().default("active"),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
  // Credencial da empresa no provedor, cifrada (lib/server/segredos.ts). Chega uma vez
  // só, na resposta do provisionamento, e precisa sobreviver a isso. Em claro aqui seria
  // a chave do financeiro de todas as empresas atendidas numa cópia de backup.
  apiTokenEncrypted: text("api_token_encrypted"),
  // Segredo com que o provedor assina os webhooks desta empresa. Mesma guarda.
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  // Como esta conexão nasceu: 'provisionado' (a plataforma criou a empresa no provedor)
  // ou 'vinculado' (a empresa já existia e o dono dela consentiu). NULL = conexão antiga,
  // configurada à mão por variável de ambiente.
  origem: text("origem"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_integrations_provider_external_company").on(table.provider, table.externalCompanyId),
  uniqueIndex("uidx_integrations_org_provider").on(table.organizationId, table.provider),
]);

export const integrationEvents = sqliteTable("integration_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("received"),
  processedAt: text("processed_at"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_integration_events_org_status").on(table.organizationId, table.status),
  index("idx_integration_events_provider_type").on(table.provider, table.eventType),
]);

export const financialChargeRequests = sqliteTable("financial_charge_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  idempotencyKey: text("idempotency_key").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  dueDate: text("due_date").notNull(),
  reminderPolicyJson: text("reminder_policy_json").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  externalChargeId: text("external_charge_id"),
  shareUrl: text("share_url"),
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_financial_charge_org_idempotency").on(table.organizationId, table.idempotencyKey),
  index("idx_financial_charge_org_project_created").on(table.organizationId, table.projectId, table.createdAt),
  index("idx_financial_charge_org_status_due").on(table.organizationId, table.status, table.dueDate),
]);

/**
 * Pedidos de emissão de nota fiscal feitos daqui.
 *
 * ─── O QUE ESTA TABELA É, E O QUE ELA NÃO É ───
 *
 * Ela NÃO é a nota. A nota é do serviço fiscal e da prefeitura; quem diz se foi
 * autorizada é a prefeitura, e é lá que ela vale. Guardar uma cópia do status como se
 * fosse verdade própria criaria uma segunda fonte, e o dia em que as duas divergissem
 * seria justamente o dia de uma nota rejeitada exibida como emitida.
 *
 * O que ela guarda é o PEDIDO: que obra, que cliente, que valor, com qual chave de
 * idempotência, e qual identificador o serviço fiscal devolveu. Sem isso, um tempo
 * esgotado no meio da emissão deixaria a plataforma sem saber se a nota saiu — e a
 * segunda tentativa emitiria a segunda nota, que só se desfaz com cancelamento, que tem
 * prazo e justificativa.
 *
 * `fiscal_status` e `fiscal_synced_at` são espelho declarado, não verdade: o valor vem da
 * última resposta real do serviço fiscal, e a data diz quando foi. A tela mostra os dois
 * juntos para poder dizer "confirmado às 14h32" em vez de afirmar um estado que ninguém
 * conferiu agora.
 */
export const fiscalNoteRequests = sqliteTable("fiscal_note_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  clientId: text("client_id").references(() => clients.id),
  idempotencyKey: text("idempotency_key").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  /** Do pedido, não da nota: `pending` (enviado, sem confirmação), `sent` (o serviço
   *  fiscal aceitou e devolveu identificador) ou `failed` (recusado ou sem resposta). */
  status: text("status").notNull().default("pending"),
  /** Identificador da nota no serviço fiscal. É por ele que o status real é consultado. */
  externalNoteId: text("external_note_id"),
  /** 'homologacao' ou 'producao' — quem decide é o cadastro fiscal da empresa, lá. */
  ambiente: text("ambiente"),
  /** Espelho do último status real: processando, autorizada, cancelada ou erro. */
  fiscalStatus: text("fiscal_status"),
  fiscalSyncedAt: text("fiscal_synced_at"),
  /** Número, verificação e links saem da prefeitura. Ficam aqui só para a listagem não
   *  precisar de uma consulta por linha; a tela sempre diz de quando são. */
  numero: text("numero"),
  urlPdf: text("url_pdf"),
  /** Motivo da recusa, como veio de lá. Trocar por texto genérico obrigaria a abrir
   *  chamado para descobrir o que a própria pessoa corrigiria. */
  lastError: text("last_error"),
  ...timestamps,
}, (table) => [
  uniqueIndex("uidx_fiscal_note_org_idempotency").on(table.organizationId, table.idempotencyKey),
  index("idx_fiscal_note_org_project_created").on(table.organizationId, table.projectId, table.createdAt),
]);

export const superadminLoginAttempts = sqliteTable("superadmin_login_attempts", {
  fingerprint: text("fingerprint").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  windowStartedAt: integer("window_started_at").notNull(),
  lockedUntil: integer("locked_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_superadmin_login_locked_until").on(table.lockedUntil)]);

export const organizationInvitations = sqliteTable("organization_invitations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  permissionsJson: text("permissions_json").notNull().default("{}"),
  tokenHash: text("token_hash").notNull(),
  invitedByEmail: text("invited_by_email").notNull(),
  expiresAt: integer("expires_at").notNull(),
  acceptedAt: integer("accepted_at"),
  acceptedByUserId: text("accepted_by_user_id"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("uidx_organization_invitations_token_hash").on(table.tokenHash),
  index("idx_organization_invitations_org_created").on(table.organizationId, table.createdAt),
  index("idx_organization_invitations_email_status").on(table.email, table.acceptedAt, table.revokedAt),
]);

export const termsAcceptances = sqliteTable("terms_acceptances", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  externalUserId: text("external_user_id").notNull(),
  email: text("email").notNull(),
  termsVersion: text("terms_version").notNull(),
  invitationId: text("invitation_id").references(() => organizationInvitations.id),
  ipHash: text("ip_hash").notNull(),
  userAgentHash: text("user_agent_hash").notNull(),
  acceptedAt: integer("accepted_at").notNull(),
}, (table) => [
  uniqueIndex("uidx_terms_acceptance_org_user_version").on(table.organizationId, table.externalUserId, table.termsVersion),
  index("idx_terms_acceptance_org_version").on(table.organizationId, table.termsVersion),
]);

// Tempo online. O servidor só credita o intervalo entre dois sinais observados, com o
// próprio relógio, e nunca mais do que USAGE_GAP_LIMIT_MS por intervalo. Sessões abertas
// ficam em usage_sessions; o total por dia, no fuso da empresa, em usage_days.
export const usageSessions = sqliteTable("usage_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  subjectId: text("subject_id").notNull(),
  subjectKind: text("subject_kind").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  memberId: text("member_id"),
  startedAt: integer("started_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  endedAt: integer("ended_at"),
  activeMs: integer("active_ms").notNull().default(0),
  beats: integer("beats").notNull().default(1),
}, (t) => [
  index("idx_usage_sessions_open").on(t.organizationId, t.subjectId, t.endedAt),
  index("idx_usage_sessions_org_started").on(t.organizationId, t.startedAt),
]);

export const usageDays = sqliteTable("usage_days", {
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  subjectId: text("subject_id").notNull(),
  day: text("day").notNull(),
  subjectKind: text("subject_kind").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  activeMs: integer("active_ms").notNull().default(0),
  sessions: integer("sessions").notNull().default(0),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
}, (t) => [
  uniqueIndex("uidx_usage_days_org_subject_day").on(t.organizationId, t.subjectId, t.day),
  index("idx_usage_days_org_day").on(t.organizationId, t.day),
  index("idx_usage_days_day").on(t.day),
]);

// Planilhas e documentos da empresa. O conteúdo é guardado como digitado; o cálculo é
// refeito por lib/spreadsheet.ts, que roda igual no navegador e no servidor.
export const worksheets = sqliteTable("worksheets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  kind: text("kind").notNull().default("sheet"),
  name: text("name").notNull(),
  contentJson: text("content_json").notNull().default("{}"),
  columns: integer("columns").notNull().default(12),
  rows: integer("rows").notNull().default(60),
  createdByMemberId: text("created_by_member_id"),
  createdByName: text("created_by_name").notNull(),
  // "organization" segue aberta à empresa; "restricted" só abre para quem o
  // superadministrador liberar em worksheet_grants.
  visibility: text("visibility").notNull().default("organization"),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [index("idx_worksheets_org_updated").on(t.organizationId, t.updatedAt)]);

// Liberações dadas pelo superadministrador: leitura, ou leitura e edição.
export const worksheetGrants = sqliteTable("worksheet_grants", {
  worksheetId: text("worksheet_id").notNull().references(() => worksheets.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  memberId: text("member_id").notNull(),
  level: text("level").notNull(),
  grantedByEmail: text("granted_by_email").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("uidx_worksheet_grants_sheet_member").on(t.worksheetId, t.memberId)]);

// Metas da empresa. O alvo é digitado; o realizado nunca é: sai sempre da fonte oficial
// do dado (tarefas concluídas, orçamentos aprovados, clientes cadastrados e assim por
// diante), recalculado a cada leitura.
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  metric: text("metric").notNull(),
  targetValue: integer("target_value").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  ownerMemberId: text("owner_member_id"),
  createdByMemberId: text("created_by_member_id"),
  createdByName: text("created_by_name").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [index("idx_goals_org_period").on(t.organizationId, t.periodEnd)]);

// Estado diário dos lembretes: o que cada acesso já viu e o que dispensou naquele dia.
// Nada aqui muda o dado de origem — um lembrete dispensado continua pendente no módulo.
export const reminderStates = sqliteTable("reminder_states", {
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  subjectId: text("subject_id").notNull(),
  day: text("day").notNull(),
  itemKey: text("item_key").notNull(),
  state: text("state").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("uidx_reminder_states_subject_day_item").on(t.organizationId, t.subjectId, t.day, t.itemKey)]);

// Credencial própria da plataforma, no lugar da identidade vinda de cabeçalhos HTTP.
//
// Antes, quem era o usuário vinha de `oai-authenticated-user-*`, injetado por uma borda
// autenticada externa. Fora dela, qualquer visitante podia enviar esses cabeçalhos e se
// passar por outra pessoa. A senha usa o mesmo PBKDF2-SHA256 já aplicado ao
// superadministrador, e o hash nunca sai daqui.
export const userCredentials = sqliteTable("user_credentials", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  active: integer("active").notNull().default(1),
  passwordUpdatedAt: integer("password_updated_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("uidx_user_credentials_email").on(t.email)]);

// Fonte própria da SINAPI: competência baixada da Caixa, conferida e só então publicada.
//
// A SINAPI é a referência oficial de custo da construção civil, publicada mensalmente pela
// Caixa como planilha — não há API com token. Esta é a nossa ingestão dela.
//
// Duas regras moldam o desenho:
//
// 1. A primeira referência exige revisão humana. A renovação automática só usa o contrato
//    homologado e para diante de mudanças de cabeçalho ou alertas de quantidade/preço.
// 2. Uma competência aprovada por UF/regime. A anterior é descartada junto com seus itens,
//    porque guardar histórico de todas as competências cresce sem limite e ninguém
//    orçamenta com tabela de dois anos atrás.
//
// A proveniência fica registrada: URL de origem, tamanho, SHA-256 do arquivo e contagens.
// É o que permite responder "de onde veio este preço" sem depender de memória.
export const sinapiCompetencias = sqliteTable("sinapi_competencias", {
  id: text("id").primaryKey(),
  // Competência no formato AAAA-MM, e o regime de desoneração da folha. A Caixa publica
  // as duas tabelas; usar a errada deixa todo orçamento errado em silêncio.
  competencia: text("competencia").notNull(),
  regime: text("regime").notNull(),
  uf: text("uf").notNull(),
  // baixando | conferindo | interpretando | importando | pendente | aprovada
  estado: text("estado").notNull(),
  origemUrl: text("origem_url").notNull(),
  arquivoSha256: text("arquivo_sha256"),
  arquivoBytes: integer("arquivo_bytes"),
  totalItens: integer("total_itens").notNull().default(0),
  // Laudo da conferência em JSON: o que foi checado, o que passou e o que destoou da
  // competência anterior. É o que o superadministrador lê antes de aprovar.
  laudoJson: text("laudo_json"),
  falha: text("falha"),
  baixadoEm: integer("baixado_em"),
  aprovadoEm: integer("aprovado_em"),
  aprovadoPor: text("aprovado_por"),
  criadoEm: integer("criado_em").notNull(),
  atualizadoEm: integer("atualizado_em").notNull(),
}, (t) => [
  uniqueIndex("uidx_sinapi_competencia_regime_uf").on(t.competencia, t.regime, t.uf),
  index("idx_sinapi_competencias_estado").on(t.estado),
]);

// Itens normalizados da competência. O custo fica em centavos, como todo dinheiro no
// projeto — a planilha traz reais com decimal, e arredondar na borda evita que a soma de
// mil itens escorra.
export const sinapiItens = sqliteTable("sinapi_itens", {
  id: text("id").primaryKey(),
  competenciaId: text("competencia_id").notNull().references(() => sinapiCompetencias.id),
  codigo: text("codigo").notNull(),
  descricao: text("descricao").notNull(),
  unidade: text("unidade").notNull(),
  custoUnitarioCentavos: integer("custo_unitario_centavos").notNull(),
  // composicao | insumo: a Caixa separa os dois, e o orçamento os usa diferente.
  tipo: text("tipo").notNull(),
}, (t) => [
  uniqueIndex("uidx_sinapi_itens_competencia_codigo").on(t.competenciaId, t.tipo, t.codigo),
  index("idx_sinapi_itens_descricao").on(t.competenciaId, t.descricao),
]);

// Configuração global: os preços oficiais são compartilhados; somente superadmin escreve.
// O lease serializa cron e ações manuais. O job persiste checkpoints no laudo da competência.
export const sinapiSync = sqliteTable("sinapi_sync", {
  id: integer("id").primaryKey(),
  configJson: text("config_json"),
  jobId: text("job_id"),
  lockToken: text("lock_token"),
  lockedUntil: integer("locked_until").notNull().default(0),
  lastChecked: integer("last_checked"),
  lastError: text("last_error"),
});

// ## Prancheta
//
// Prancha de desenho da empresa. O documento inteiro fica num único JSON (`documento`),
// e não em uma tabela por elemento, por uma razão prática: um traço só tem sentido junto
// dos outros, e salvar planta é sempre salvar a versão inteira. Espalhar 5 mil elementos
// em linhas transformaria cada gravação em transação gigante sem ganhar consulta nenhuma
// — ninguém pergunta ao banco "quais tomadas existem"; pergunta à planta aberta.
//
// `revisao` é o que impede que duas abas abertas se sobrescrevam em silêncio: quem grava
// declara a revisão que leu, e o servidor recusa se ela já avançou.
export const studioDrawings = sqliteTable("studio_drawings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  // Prancha pode nascer solta — o estudo vem antes do projeto existir no sistema.
  projectId: text("project_id").references(() => projects.id),
  nome: text("nome").notNull(),
  // planta | corte | elevacao | detalhe | apresentacao: muda o carimbo e o que se espera
  // ver, não a geometria.
  especie: text("especie").notNull().default("planta"),
  documento: text("documento").notNull(),
  revisao: integer("revisao").notNull().default(1),
  criadoPorMembroId: text("criado_por_membro_id").references(() => members.id),
  atualizadoPorMembroId: text("atualizado_por_membro_id").references(() => members.id),
  ...timestamps,
}, (table) => [
  index("idx_studio_drawings_org").on(table.organizationId, table.updatedAt),
  index("idx_studio_drawings_org_project").on(table.organizationId, table.projectId),
]);

// Biblioteca de imagens da empresa: mobiliário recortado, textura, foto de referência e o
// PDF ou imagem usado como fundo de traçado. Os bytes vão cifrados para o armazenamento,
// pelo mesmo caminho das fotos do diário; aqui fica só a chave e o que descreve o item.
//
// O DWG entra aqui como anexo e é assumido como anexo: não existe leitor livre confiável
// do formato, e abrir uma planta errada é pior do que dizer que não abre.
export const studioAssets = sqliteTable("studio_assets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  storageKey: text("storage_key").notNull(),
  nome: text("nome").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  // mobilia | textura | referencia | fundo | anexo
  categoria: text("categoria").notNull().default("referencia"),
  // Medida real do objeto, quando conhecida: um sofá colado na planta sem escala mente
  // sobre o espaço que sobra na sala.
  larguraMm: integer("largura_mm"),
  alturaMm: integer("altura_mm"),
  enviadoPorMembroId: text("enviado_por_membro_id").references(() => members.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uidx_studio_assets_storage_key").on(table.storageKey),
  index("idx_studio_assets_org").on(table.organizationId, table.categoria),
]);

// Vigilância das fontes dos parâmetros normativos.
//
// Guarda a impressão digital do que a página da norma dizia na última conferência. É o
// que permite avisar "a NBR 5410 mudou de página" sem API e sem custo — e é tudo o que
// esta tabela faz: ela não guarda parâmetro, guarda o sinal de que alguém precisa olhar.
//
// Global, e não por empresa: a norma é a mesma para todo mundo.
export const parametroFontes = sqliteTable("parametro_fontes", {
  id: text("id").primaryKey(),
  assinatura: text("assinatura"),
  // igual | mudou | primeira | inalcancavel
  estado: text("estado"),
  detalhe: text("detalhe"),
  conferidoEm: integer("conferido_em"),
  // Momento em que uma pessoa olhou a mudança e deu por resolvida. Enquanto for nulo e o
  // estado for "mudou", o aviso continua de pé.
  revisadoEm: integer("revisado_em"),
  revisadoPor: text("revisado_por"),
});

// Arquivo da empresa guardado em partes cifradas.
//
// A função da Vercel recusa corpo acima de 4,5 MB, e planta em DWG ou PDF passa disso
// com frequência. Então o arquivo sobe em partes de até 3 MB, cada uma cifrada como as
// fotos do diário, e desce do mesmo jeito: o navegador junta as partes e devolve o
// arquivo byte a byte, no formato original.
//
// Um mesmo arquivo serve à Prancheta e à Comunicação. `in_library` diz se ele aparece
// na biblioteca da Prancheta; mensagens apontam para ele por `chat_message_files`. O
// objeto só é apagado quando não está na biblioteca e nenhuma mensagem o usa.
export const orgFiles = sqliteTable("org_files", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").references(() => projects.id),
  name: text("name").notNull(),
  extension: text("extension").notNull().default(""),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  chunkSize: integer("chunk_size").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  // uploading | ready
  status: text("status").notNull().default("uploading"),
  inLibrary: integer("in_library").notNull().default(0),
  // Arquivo de origem de uma conversão e o tipo dela (dwg-dxf, dxf-pdf, pdf-png…).
  sourceFileId: text("source_file_id"),
  conversion: text("conversion"),
  uploadedByMemberId: text("uploaded_by_member_id").notNull(),
  uploadedByName: text("uploaded_by_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  readyAt: text("ready_at"),
}, (table) => [
  index("idx_org_files_library").on(table.organizationId, table.inLibrary, table.status),
  index("idx_org_files_source").on(table.organizationId, table.sourceFileId, table.conversion),
]);

export const orgFileChunks = sqliteTable("org_file_chunks", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull().references(() => orgFiles.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  chunkIndex: integer("chunk_index").notNull(),
  storageKey: text("storage_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
}, (table) => [
  uniqueIndex("uidx_org_file_chunks_part").on(table.fileId, table.chunkIndex),
  uniqueIndex("uidx_org_file_chunks_storage_key").on(table.storageKey),
]);

// Comunicação interna da empresa. Canal é aberto a todo membro ativo da empresa;
// conversa direta só aos dois participantes. `key` impede canal repetido e duas
// conversas diretas entre as mesmas pessoas.
export const chatChannels = sqliteTable("chat_channels", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  // canal | direta
  kind: text("kind").notNull(),
  key: text("key").notNull(),
  name: text("name"),
  createdByMemberId: text("created_by_member_id").notNull(),
  createdAt: text("created_at").notNull(),
  lastMessageAt: text("last_message_at"),
}, (table) => [
  uniqueIndex("uidx_chat_channels_key").on(table.organizationId, table.key),
]);

// Participante da conversa direta e marca de leitura de qualquer conversa.
export const chatParticipants = sqliteTable("chat_participants", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => chatChannels.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  memberId: text("member_id").notNull(),
  isMember: integer("is_member").notNull().default(0),
  lastReadAt: text("last_read_at"),
}, (table) => [
  uniqueIndex("uidx_chat_participants_member").on(table.channelId, table.memberId),
  index("idx_chat_participants_org_member").on(table.organizationId, table.memberId),
]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  channelId: text("channel_id").notNull().references(() => chatChannels.id),
  authorMemberId: text("author_member_id").notNull(),
  authorName: text("author_name").notNull(),
  // Gerado pelo navegador: reenviar depois de falha de rede não duplica a mensagem.
  clientKey: text("client_key").notNull(),
  body: text("body").notNull().default(""),
  // mensagem | lembrete
  kind: text("kind").notNull().default("mensagem"),
  createdAt: text("created_at").notNull(),
  editedAt: text("edited_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("uidx_chat_messages_client_key").on(table.organizationId, table.authorMemberId, table.clientKey),
  index("idx_chat_messages_channel").on(table.organizationId, table.channelId, table.createdAt),
]);

export const chatMessageFiles = sqliteTable("chat_message_files", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => chatMessages.id),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  fileId: text("file_id").notNull().references(() => orgFiles.id),
  position: integer("position").notNull().default(0),
}, (table) => [
  uniqueIndex("uidx_chat_message_files").on(table.messageId, table.fileId),
  index("idx_chat_message_files_file").on(table.organizationId, table.fileId),
]);

// Lembrete criado na conversa. Aparece em "Lembretes do dia" para quem ele se destina
// (uma pessoa, ou todos que participam da conversa) até alguém marcar como feito.
export const chatReminders = sqliteTable("chat_reminders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  channelId: text("channel_id").notNull().references(() => chatChannels.id),
  messageId: text("message_id").notNull().references(() => chatMessages.id),
  createdByMemberId: text("created_by_member_id").notNull(),
  createdByName: text("created_by_name").notNull(),
  targetMemberId: text("target_member_id"),
  text: text("text").notNull(),
  dueDay: text("due_day").notNull(),
  doneAt: text("done_at"),
  doneByName: text("done_by_name"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("uidx_chat_reminders_message").on(table.messageId),
  index("idx_chat_reminders_due").on(table.organizationId, table.doneAt, table.dueDay),
]);

// Criador de layout: planta com móveis, eletrodomésticos e veículos, e prévia 3D gerada
// dela. O conteúdo é geometria validada (lib/layout.ts); imagem nunca é guardada aqui, é
// gerada do documento e vai para a Prancheta quando a pessoa exporta.
export const layouts = sqliteTable("layouts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  projectId: text("project_id").references(() => projects.id),
  name: text("name").notNull(),
  contentJson: text("content_json").notNull(),
  // Controle de edição concorrente: salvar exige a revisão que a pessoa abriu.
  revision: integer("revision").notNull().default(1),
  createdByName: text("created_by_name").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_layouts_org_updated").on(table.organizationId, table.updatedAt),
]);
