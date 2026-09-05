CREATE TABLE `budget_items` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_version_id` text NOT NULL,
	`parent_item_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`code` text,
	`description` text NOT NULL,
	`unit` text DEFAULT 'un' NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`unit_price_cents` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_reference` text,
	FOREIGN KEY (`budget_version_id`) REFERENCES `budget_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_budget_items_version_order` ON `budget_items` (`budget_version_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `budget_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`code` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`direct_cost_cents` integer DEFAULT 0 NOT NULL,
	`bdi_percent` real DEFAULT 0 NOT NULL,
	`margin_percent` real DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_budget_versions_org_code_version` ON `budget_versions` (`organization_id`,`code`,`version`);--> statement-breakpoint
CREATE INDEX `idx_budget_versions_project_status` ON `budget_versions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`document` text,
	`email` text,
	`phone` text,
	`external_financial_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_clients_org_name` ON `clients` (`organization_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_clients_org_external_financial` ON `clients` (`organization_id`,`external_financial_id`);--> statement-breakpoint
CREATE TABLE `crm_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text,
	`title` text NOT NULL,
	`stage` text DEFAULT 'new' NOT NULL,
	`estimated_value_cents` integer DEFAULT 0 NOT NULL,
	`probability_percent` integer DEFAULT 0 NOT NULL,
	`owner_member_id` text,
	`next_action` text,
	`next_action_at` text,
	`won_project_id` text,
	`lost_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`won_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_crm_org_stage` ON `crm_opportunities` (`organization_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_org_next_action` ON `crm_opportunities` (`organization_id`,`next_action_at`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_company_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_integrations_provider_external_company` ON `integration_connections` (`provider`,`external_company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_integrations_org_provider` ON `integration_connections` (`organization_id`,`provider`);--> statement-breakpoint
CREATE TABLE `integration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`processed_at` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_integration_events_org_status` ON `integration_events` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_integration_events_provider_type` ON `integration_events` (`provider`,`event_type`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`weekly_capacity_minutes` integer DEFAULT 2400 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_members_org_external_user` ON `members` (`organization_id`,`external_user_id`);--> statement-breakpoint
CREATE INDEX `idx_members_org_active` ON `members` (`organization_id`,`active`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_organizations_slug` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`storage_key` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`uploaded_by_member_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_project_files_storage_key` ON `project_files` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_project_files_org_project` ON `project_files` (`organization_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'project' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`phase` text DEFAULT 'briefing' NOT NULL,
	`progress_percent` integer DEFAULT 0 NOT NULL,
	`owner_member_id` text,
	`start_date` text,
	`target_date` text,
	`budget_cents` integer DEFAULT 0 NOT NULL,
	`external_financial_cost_center_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_projects_org_code` ON `projects` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_projects_org_status` ON `projects` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_projects_org_kind_status` ON `projects` (`organization_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `idx_projects_client` ON `projects` (`client_id`);--> statement-breakpoint
CREATE TABLE `site_diary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`weather` text,
	`workforce_count` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	`blockers` text DEFAULT '' NOT NULL,
	`author_member_id` text,
	`client_signed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_site_diary_project_date` ON `site_diary_entries` (`project_id`,`entry_date`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`assignee_member_id` text,
	`parent_task_id` text,
	`starts_at` text,
	`due_at` text,
	`estimated_minutes` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_org_status_due` ON `tasks` (`organization_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project_status` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_assignee_status` ON `tasks` (`assignee_member_id`,`status`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`member_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`minutes` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_time_entries_org_project_started` ON `time_entries` (`organization_id`,`project_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_member_started` ON `time_entries` (`member_id`,`started_at`);