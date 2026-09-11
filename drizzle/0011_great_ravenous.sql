CREATE TABLE `usage_days` (
	`organization_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`day` text NOT NULL,
	`subject_kind` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_usage_days_org_subject_day` ON `usage_days` (`organization_id`,`subject_id`,`day`);--> statement-breakpoint
CREATE INDEX `idx_usage_days_org_day` ON `usage_days` (`organization_id`,`day`);--> statement-breakpoint
CREATE INDEX `idx_usage_days_day` ON `usage_days` (`day`);--> statement-breakpoint
CREATE TABLE `usage_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`member_id` text,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`ended_at` integer,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`beats` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_usage_sessions_open` ON `usage_sessions` (`organization_id`,`subject_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_sessions_org_started` ON `usage_sessions` (`organization_id`,`started_at`);