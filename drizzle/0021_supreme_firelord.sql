CREATE TABLE `fiscal_note_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`client_id` text,
	`idempotency_key` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_note_id` text,
	`ambiente` text,
	`fiscal_status` text,
	`fiscal_synced_at` text,
	`numero` text,
	`url_pdf` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_fiscal_note_org_idempotency` ON `fiscal_note_requests` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_note_org_project_created` ON `fiscal_note_requests` (`organization_id`,`project_id`,`created_at`);