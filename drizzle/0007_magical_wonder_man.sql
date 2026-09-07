CREATE TABLE `diary_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`slot` integer NOT NULL,
	`storage_key` text NOT NULL,
	`name` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_by_member_id` text,
	`uploaded_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `site_diary_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_diary_photos_entry_slot` ON `diary_photos` (`entry_id`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_diary_photos_storage_key` ON `diary_photos` (`storage_key`);--> statement-breakpoint
CREATE TABLE `diary_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`editor_member_id` text,
	`editor_name` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`) REFERENCES `site_diary_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`editor_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_diary_revisions_entry_revision` ON `diary_revisions` (`entry_id`,`revision`);--> statement-breakpoint
ALTER TABLE `site_diary_entries` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `site_diary_entries` ADD `author_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `site_diary_entries` ADD `occurrence_type` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_site_diary_org_date` ON `site_diary_entries` (`organization_id`,`entry_date`,`id`);--> statement-breakpoint
PRAGMA optimize;
