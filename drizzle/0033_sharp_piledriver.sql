CREATE TABLE `member_delegations` (
	`member_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`can_create_accounts` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_member_delegations_org` ON `member_delegations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organization_branding` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`menu_color` text,
	`accent_color` text,
	`band_color` text,
	`logo_mime` text,
	`logo_base64` text,
	`logo_version` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organization_modules` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`enabled_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
