import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
};

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('organizations_slug_unique').on(table.slug)]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  ...timestamps,
}, (table) => [uniqueIndex('users_email_unique').on(table.email)]);

export const organizationMembers = sqliteTable('organization_members', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role', { enum: ['owner', 'admin', 'manager', 'member', 'partner', 'client'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('organization_members_org_user_unique').on(table.organizationId, table.userId),
  index('organization_members_user_idx').on(table.userId),
]);

export const clients = sqliteTable('clients', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  remoteId: text('remote_id'),
  ...timestamps,
}, (table) => [
  index('clients_org_name_idx').on(table.organizationId, table.name),
]);

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  clientId: text('client_id').references(() => clients.id),
  name: text('name').notNull(),
  code: text('code').notNull(),
  type: text('type').notNull(),
  stage: text('stage').notNull().default('briefing'),
  status: text('status', { enum: ['lead', 'active', 'paused', 'completed', 'cancelled'] }).notNull().default('active'),
  progress: integer('progress').notNull().default(0),
  startsAt: integer('starts_at', { mode: 'timestamp_ms' }),
  deadlineAt: integer('deadline_at', { mode: 'timestamp_ms' }),
  drapCostCenterId: text('drap_cost_center_id'),
  ...timestamps,
}, (table) => [
  uniqueIndex('projects_org_code_unique').on(table.organizationId, table.code),
  index('projects_org_status_idx').on(table.organizationId, table.status),
  index('projects_org_deadline_idx').on(table.organizationId, table.deadlineAt),
]);

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  assigneeUserId: text('assignee_user_id').references(() => users.id),
  title: text('title').notNull(),
  status: text('status', { enum: ['todo', 'doing', 'blocked', 'done'] }).notNull().default('todo'),
  priority: text('priority', { enum: ['low', 'medium', 'high', 'urgent'] }).notNull().default('medium'),
  dueAt: integer('due_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  ...timestamps,
}, (table) => [
  index('tasks_org_status_due_idx').on(table.organizationId, table.status, table.dueAt),
  index('tasks_project_idx').on(table.projectId),
  index('tasks_assignee_idx').on(table.assigneeUserId, table.status),
]);

export const projectFiles = sqliteTable('project_files', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  objectKey: text('object_key').notNull(),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  revision: integer('revision').notNull().default(1),
  uploadedByUserId: text('uploaded_by_user_id').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('project_files_object_key_unique').on(table.objectKey),
  index('project_files_org_project_idx').on(table.organizationId, table.projectId),
]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('audit_events_org_created_idx').on(table.organizationId, table.createdAt)]);
