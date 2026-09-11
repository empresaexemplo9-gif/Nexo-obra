CREATE TABLE `financial_charge_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text,
	`idempotency_key` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`reminder_policy_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_charge_id` text,
	`share_url` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_financial_charge_org_idempotency` ON `financial_charge_requests` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_financial_charge_org_project_created` ON `financial_charge_requests` (`organization_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_financial_charge_org_status_due` ON `financial_charge_requests` (`organization_id`,`status`,`due_date`);--> statement-breakpoint
PRAGMA optimize;
