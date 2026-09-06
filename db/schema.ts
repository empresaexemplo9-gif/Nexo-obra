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
  ...timestamps,
}, (table) => [
  index("idx_site_diary_project_date").on(table.projectId, table.entryDate),
]);

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
