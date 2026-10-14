CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_password_resets_token` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_password_resets_user` ON `password_resets` (`user_id`);