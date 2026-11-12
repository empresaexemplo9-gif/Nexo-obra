CREATE TABLE `stock_minimums` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location` text NOT NULL,
	`minimum` real NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `purchase_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_stock_minimums_product_location` ON `stock_minimums` (`organization_id`,`product_id`,`location`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`product_id` text NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`quantity` real NOT NULL,
	`unit_cost_cents` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`request_id` text,
	`client_key` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`occurred_on` text NOT NULL,
	`author_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `purchase_products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_stock_movements_client_key` ON `stock_movements` (`organization_id`,`client_key`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_product` ON `stock_movements` (`organization_id`,`product_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_movements_created` ON `stock_movements` (`organization_id`,`created_at`);