CREATE TABLE IF NOT EXISTS `members` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `uidx_members_org_external_user` ON `members` (`organization_id`,`external_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_members_org_active` ON `members` (`organization_id`,`active`);--> statement-breakpoint
INSERT OR IGNORE INTO `members` (`id`, `organization_id`, `external_user_id`, `name`, `email`, `role`, `created_at`, `updated_at`)
SELECT om.`id`, om.`organization_id`, om.`user_id`, COALESCE(NULLIF(u.`display_name`, ''), u.`email`), u.`email`, om.`role`, CAST(om.`created_at` AS text), CAST(om.`created_at` AS text)
FROM `organization_members` om
INNER JOIN `users` u ON u.`id` = om.`user_id`;--> statement-breakpoint

ALTER TABLE `organizations` ADD COLUMN `timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint

ALTER TABLE `clients` ADD COLUMN `document` text;--> statement-breakpoint
ALTER TABLE `clients` ADD COLUMN `external_financial_id` text;--> statement-breakpoint
ALTER TABLE `clients` ADD COLUMN `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `clients` SET `external_financial_id` = `remote_id` WHERE `external_financial_id` IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_clients_org_name` ON `clients` (`organization_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uidx_clients_org_external_financial` ON `clients` (`organization_id`,`external_financial_id`);--> statement-breakpoint

ALTER TABLE `projects` ADD COLUMN `kind` text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `phase` text DEFAULT 'briefing' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `progress_percent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `owner_member_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `start_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `target_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `budget_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `external_financial_cost_center_id` text;--> statement-breakpoint
UPDATE `projects`
SET `kind` = CASE WHEN lower(`type`) IN ('work', 'obra') THEN 'work' ELSE 'project' END,
	`phase` = COALESCE(NULLIF(`stage`, ''), 'briefing'),
	`progress_percent` = COALESCE(`progress`, 0),
	`start_date` = CASE WHEN `starts_at` IS NULL THEN NULL ELSE CAST(`starts_at` AS text) END,
	`target_date` = CASE WHEN `deadline_at` IS NULL THEN NULL ELSE CAST(`deadline_at` AS text) END,
	`external_financial_cost_center_id` = `drap_cost_center_id`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uidx_projects_org_code` ON `projects` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_projects_org_status` ON `projects` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_projects_org_kind_status` ON `projects` (`organization_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_projects_client` ON `projects` (`client_id`);--> statement-breakpoint

ALTER TABLE `tasks` ADD COLUMN `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `assignee_member_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `parent_task_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `starts_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `estimated_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `tasks`
SET `assignee_member_id` = (
	SELECT m.`id` FROM `members` m
	WHERE m.`organization_id` = `tasks`.`organization_id` AND m.`external_user_id` = `tasks`.`assignee_user_id`
	LIMIT 1
)
WHERE `assignee_user_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_org_status_due` ON `tasks` (`organization_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_project_status` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_assignee_status` ON `tasks` (`assignee_member_id`,`status`);--> statement-breakpoint

ALTER TABLE `project_files` ADD COLUMN `storage_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD COLUMN `mime_type` text DEFAULT 'application/octet-stream' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD COLUMN `size_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD COLUMN `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD COLUMN `uploaded_by_member_id` text;--> statement-breakpoint
UPDATE `project_files`
SET `storage_key` = `object_key`, `mime_type` = `content_type`, `size_bytes` = `size`, `version` = `revision`,
	`uploaded_by_member_id` = (
		SELECT m.`id` FROM `members` m
		WHERE m.`organization_id` = `project_files`.`organization_id` AND m.`external_user_id` = `project_files`.`uploaded_by_user_id`
		LIMIT 1
	);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uidx_project_files_storage_key` ON `project_files` (`storage_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_files_org_project` ON `project_files` (`organization_id`,`project_id`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `budget_versions` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `uidx_budget_versions_org_code_version` ON `budget_versions` (`organization_id`,`code`,`version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_budget_versions_project_status` ON `budget_versions` (`project_id`,`status`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `budget_items` (
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
CREATE INDEX IF NOT EXISTS `idx_budget_items_version_order` ON `budget_items` (`budget_version_id`,`sort_order`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `crm_opportunities` (
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
CREATE INDEX IF NOT EXISTS `idx_crm_org_stage` ON `crm_opportunities` (`organization_id`,`stage`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_crm_org_next_action` ON `crm_opportunities` (`organization_id`,`next_action_at`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `integration_connections` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `uidx_integrations_provider_external_company` ON `integration_connections` (`provider`,`external_company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uidx_integrations_org_provider` ON `integration_connections` (`organization_id`,`provider`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `integration_events` (
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
CREATE INDEX IF NOT EXISTS `idx_integration_events_org_status` ON `integration_events` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_integration_events_provider_type` ON `integration_events` (`provider`,`event_type`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `site_diary_entries` (
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
CREATE INDEX IF NOT EXISTS `idx_site_diary_project_date` ON `site_diary_entries` (`project_id`,`entry_date`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `time_entries` (
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
CREATE INDEX IF NOT EXISTS `idx_time_entries_org_project_started` ON `time_entries` (`organization_id`,`project_id`,`started_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_time_entries_member_started` ON `time_entries` (`member_id`,`started_at`);
