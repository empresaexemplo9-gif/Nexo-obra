CREATE TABLE `superadmin_login_attempts` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_superadmin_login_locked_until` ON `superadmin_login_attempts` (`locked_until`);