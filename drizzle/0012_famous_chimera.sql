CREATE TABLE `worksheets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text DEFAULT 'sheet' NOT NULL,
	`name` text NOT NULL,
	`content_json` text DEFAULT '{}' NOT NULL,
	`columns` integer DEFAULT 12 NOT NULL,
	`rows` integer DEFAULT 60 NOT NULL,
	`created_by_member_id` text,
	`created_by_name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_worksheets_org_updated` ON `worksheets` (`organization_id`,`updated_at`);