CREATE TABLE `organization_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_user_id` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_organization_invitations_token_hash` ON `organization_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_organization_invitations_org_created` ON `organization_invitations` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_organization_invitations_email_status` ON `organization_invitations` (`email`,`accepted_at`,`revoked_at`);