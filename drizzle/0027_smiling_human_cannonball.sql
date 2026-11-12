CREATE TABLE `meeting_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`company` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`team_size` text NOT NULL,
	`preferred_day` text NOT NULL,
	`preferred_period` text NOT NULL,
	`message` text,
	`origin` text DEFAULT 'home' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`ip_hash` text NOT NULL,
	`user_agent_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meeting_requests_created` ON `meeting_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_meeting_requests_ip` ON `meeting_requests` (`ip_hash`,`created_at`);