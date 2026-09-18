CREATE TABLE `studio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`nome` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`categoria` text DEFAULT 'referencia' NOT NULL,
	`largura_mm` integer,
	`altura_mm` integer,
	`enviado_por_membro_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enviado_por_membro_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_studio_assets_storage_key` ON `studio_assets` (`storage_key`);--> statement-breakpoint
CREATE INDEX `idx_studio_assets_org` ON `studio_assets` (`organization_id`,`categoria`);--> statement-breakpoint
CREATE TABLE `studio_drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`nome` text NOT NULL,
	`especie` text DEFAULT 'planta' NOT NULL,
	`documento` text NOT NULL,
	`revisao` integer DEFAULT 1 NOT NULL,
	`criado_por_membro_id` text,
	`atualizado_por_membro_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por_membro_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`atualizado_por_membro_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_studio_drawings_org` ON `studio_drawings` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_studio_drawings_org_project` ON `studio_drawings` (`organization_id`,`project_id`);