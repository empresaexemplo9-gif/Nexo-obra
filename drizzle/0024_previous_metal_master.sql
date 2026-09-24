CREATE TABLE `layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`content_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_name` text NOT NULL,
	`updated_by_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_layouts_org_updated` ON `layouts` (`organization_id`,`updated_at`);