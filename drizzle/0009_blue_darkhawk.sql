CREATE TABLE `drap_activation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`digest` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `drap_activations` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`request_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`subscription_id` text,
	`base_cents` integer,
	`monthly_cents` integer,
	`remote_revision` integer DEFAULT 0 NOT NULL,
	`last_requested_at` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_drap_activation_company` ON `drap_activations` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_drap_activation_request` ON `drap_activations` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_drap_activation_subscription` ON `drap_activations` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `platform_access_rules` (
	`organization_id` text NOT NULL,
	`subject` text NOT NULL,
	`state` text NOT NULL,
	`until` integer,
	`reason` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_platform_access_subject` ON `platform_access_rules` (`organization_id`,`subject`);