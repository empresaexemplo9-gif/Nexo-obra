CREATE TABLE `client_portal_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`access_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`terms_version` text NOT NULL,
	`ip_hash` text NOT NULL,
	`user_agent_hash` text NOT NULL,
	`accepted_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_id`) REFERENCES `client_portal_access`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_client_portal_acceptance_version` ON `client_portal_acceptances` (`access_id`,`external_user_id`,`terms_version`);--> statement-breakpoint
CREATE TABLE `client_portal_access` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`external_user_id` text,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`view_progress` integer DEFAULT true NOT NULL,
	`can_approve` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_member_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_client_portal_access_token` ON `client_portal_access` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_client_portal_access_project_email` ON `client_portal_access` (`organization_id`,`project_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_client_portal_access_identity_status` ON `client_portal_access` (`external_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `client_portal_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`access_id` text NOT NULL,
	`item_id` text NOT NULL,
	`choice` text NOT NULL,
	`comment` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`ip_hash` text NOT NULL,
	`user_agent_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_id`) REFERENCES `client_portal_access`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `client_portal_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_client_portal_decision_item` ON `client_portal_decisions` (`item_id`);--> statement-breakpoint
CREATE TABLE `client_portal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`access_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`due_date` text,
	`source_diary_id` text,
	`source_diary_revision` integer,
	`photo_ids_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by_member_id` text NOT NULL,
	`author_name` text NOT NULL,
	`withdrawal_reason` text DEFAULT '' NOT NULL,
	`withdrawn_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_id`) REFERENCES `client_portal_access`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_diary_id`) REFERENCES `site_diary_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_client_portal_items_access_created` ON `client_portal_items` (`access_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_client_portal_items_org_project` ON `client_portal_items` (`organization_id`,`project_id`,`created_at`);
--> statement-breakpoint
PRAGMA optimize;
