CREATE TABLE `supplier_price_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`list_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`unit` text NOT NULL,
	`price_cents` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`list_id`) REFERENCES `supplier_price_lists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_supplier_price_items_org_description` ON `supplier_price_items` (`organization_id`,`description`);--> statement-breakpoint
CREATE INDEX `idx_supplier_price_items_list` ON `supplier_price_items` (`list_id`);--> statement-breakpoint
CREATE TABLE `supplier_price_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`valid_on` text NOT NULL,
	`total_items` integer NOT NULL,
	`ignored` integer DEFAULT 0 NOT NULL,
	`imported_by_name` text NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_supplier_price_lists_supplier` ON `supplier_price_lists` (`organization_id`,`supplier_id`);--> statement-breakpoint
ALTER TABLE `suppliers` ADD `registry_name` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `registry_status` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `registry_activity` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `registry_checked_at` text;