CREATE TABLE `goinfra_itens` (
	`id` text PRIMARY KEY NOT NULL,
	`tabela_id` text NOT NULL,
	`codigo` text NOT NULL,
	`descricao` text NOT NULL,
	`unidade` text NOT NULL,
	`custo_unitario_centavos` integer NOT NULL,
	FOREIGN KEY (`tabela_id`) REFERENCES `goinfra_tabelas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_goinfra_itens_tabela_codigo` ON `goinfra_itens` (`tabela_id`,`codigo`);--> statement-breakpoint
CREATE INDEX `idx_goinfra_itens_descricao` ON `goinfra_itens` (`tabela_id`,`descricao`);--> statement-breakpoint
CREATE TABLE `goinfra_tabelas` (
	`id` text PRIMARY KEY NOT NULL,
	`referencia` text NOT NULL,
	`tabela` text NOT NULL,
	`regime` text NOT NULL,
	`arquivo_nome` text NOT NULL,
	`arquivo_sha256` text NOT NULL,
	`arquivo_bytes` integer NOT NULL,
	`aba` text DEFAULT '' NOT NULL,
	`total_itens` integer NOT NULL,
	`ignoradas` integer DEFAULT 0 NOT NULL,
	`importado_por` text NOT NULL,
	`importado_em` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_goinfra_tabela_regime` ON `goinfra_tabelas` (`tabela`,`regime`);--> statement-breakpoint
CREATE TABLE `purchase_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`author_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_events_request` ON `purchase_events` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `purchase_products` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Geral' NOT NULL,
	`unit` text DEFAULT 'un' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_reference` text,
	`reference_cost_cents` integer,
	`reference_label` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_products_org_name` ON `purchase_products` (`organization_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_purchase_products_org_reference` ON `purchase_products` (`organization_id`,`source_reference`);--> statement-breakpoint
CREATE TABLE `purchase_quote_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`request_item_id` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `purchase_quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_item_id`) REFERENCES `purchase_request_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_purchase_quote_items_quote_item` ON `purchase_quote_items` (`quote_id`,`request_item_id`);--> statement-breakpoint
CREATE TABLE `purchase_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`request_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`delivery_days` integer NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`payment_days` integer DEFAULT 0 NOT NULL,
	`freight_cents` integer DEFAULT 0 NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`valid_until` text,
	`negotiation_score` integer DEFAULT 3 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_purchase_quotes_request_supplier` ON `purchase_quotes` (`request_id`,`supplier_id`);--> statement-breakpoint
CREATE TABLE `purchase_request_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`request_id` text NOT NULL,
	`product_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`description` text NOT NULL,
	`unit` text DEFAULT 'un' NOT NULL,
	`quantity` real NOT NULL,
	`received_quantity` real DEFAULT 0 NOT NULL,
	`reference_cost_cents` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`request_id`) REFERENCES `purchase_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `purchase_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_purchase_request_items_request` ON `purchase_request_items` (`request_id`,`position`);--> statement-breakpoint
CREATE TABLE `purchase_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` integer NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'a_orcar' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`needed_by` text,
	`delivery_address` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`selected_quote_id` text,
	`order_number` text DEFAULT '' NOT NULL,
	`ordered_at` text,
	`purchased_total_cents` integer,
	`expected_delivery_date` text,
	`carrier` text DEFAULT '' NOT NULL,
	`tracking_code` text DEFAULT '' NOT NULL,
	`dispatched_at` text,
	`delivered_at` text,
	`cancel_reason` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_purchase_requests_org_number` ON `purchase_requests` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_purchase_requests_org_status` ON `purchase_requests` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_purchase_requests_org_project` ON `purchase_requests` (`organization_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`document` text,
	`contact_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`uf` text DEFAULT '' NOT NULL,
	`categories` text DEFAULT '' NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`lead_time_days` integer,
	`negotiation_score` integer,
	`notes` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_suppliers_org_name` ON `suppliers` (`organization_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_suppliers_org_document` ON `suppliers` (`organization_id`,`document`);