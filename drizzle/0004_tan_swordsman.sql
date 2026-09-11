CREATE TABLE `terms_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`external_user_id` text NOT NULL,
	`email` text NOT NULL,
	`terms_version` text NOT NULL,
	`invitation_id` text,
	`ip_hash` text NOT NULL,
	`user_agent_hash` text NOT NULL,
	`accepted_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invitation_id`) REFERENCES `organization_invitations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_terms_acceptance_org_user_version` ON `terms_acceptances` (`organization_id`,`external_user_id`,`terms_version`);--> statement-breakpoint
CREATE INDEX `idx_terms_acceptance_org_version` ON `terms_acceptances` (`organization_id`,`terms_version`);--> statement-breakpoint
ALTER TABLE `members` ADD `permissions_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_invitations` ADD `permissions_json` text DEFAULT '{}' NOT NULL;