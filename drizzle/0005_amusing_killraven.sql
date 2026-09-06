CREATE TABLE `budget_catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`category` text DEFAULT 'Geral' NOT NULL,
	`unit` text DEFAULT 'un' NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	`default_unit_price_cents` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_reference` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_budget_catalog_org_source_code` ON `budget_catalog_items` (`organization_id`,`source`,`code`);--> statement-breakpoint
CREATE INDEX `idx_budget_catalog_org_category` ON `budget_catalog_items` (`organization_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_budget_catalog_org_description` ON `budget_catalog_items` (`organization_id`,`description`);--> statement-breakpoint
PRAGMA optimize;
