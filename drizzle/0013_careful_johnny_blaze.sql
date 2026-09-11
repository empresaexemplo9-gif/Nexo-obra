CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`metric` text NOT NULL,
	`target_value` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`owner_member_id` text,
	`created_by_member_id` text,
	`created_by_name` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_goals_org_period` ON `goals` (`organization_id`,`period_end`);--> statement-breakpoint
CREATE TABLE `reminder_states` (
	`organization_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`day` text NOT NULL,
	`item_key` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_reminder_states_subject_day_item` ON `reminder_states` (`organization_id`,`subject_id`,`day`,`item_key`);