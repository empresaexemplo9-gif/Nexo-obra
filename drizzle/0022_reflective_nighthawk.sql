CREATE TABLE `platform_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`tipo` text NOT NULL,
	`subject_id` text NOT NULL,
	`rotulo` text NOT NULL,
	`actor` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_platform_deletions_created` ON `platform_deletions` (`created_at`);