CREATE TABLE `worksheet_grants` (
	`worksheet_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`member_id` text NOT NULL,
	`level` text NOT NULL,
	`granted_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`worksheet_id`) REFERENCES `worksheets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_worksheet_grants_sheet_member` ON `worksheet_grants` (`worksheet_id`,`member_id`);--> statement-breakpoint
ALTER TABLE `worksheets` ADD `visibility` text DEFAULT 'organization' NOT NULL;