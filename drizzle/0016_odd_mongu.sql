CREATE TABLE `sinapi_competencias` (
	`id` text PRIMARY KEY NOT NULL,
	`competencia` text NOT NULL,
	`regime` text NOT NULL,
	`uf` text NOT NULL,
	`estado` text NOT NULL,
	`origem_url` text NOT NULL,
	`arquivo_sha256` text,
	`arquivo_bytes` integer,
	`total_itens` integer DEFAULT 0 NOT NULL,
	`laudo_json` text,
	`falha` text,
	`baixado_em` integer,
	`aprovado_em` integer,
	`aprovado_por` text,
	`criado_em` integer NOT NULL,
	`atualizado_em` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_sinapi_competencia_regime_uf` ON `sinapi_competencias` (`competencia`,`regime`,`uf`);--> statement-breakpoint
CREATE INDEX `idx_sinapi_competencias_estado` ON `sinapi_competencias` (`estado`);--> statement-breakpoint
CREATE TABLE `sinapi_itens` (
	`id` text PRIMARY KEY NOT NULL,
	`competencia_id` text NOT NULL,
	`codigo` text NOT NULL,
	`descricao` text NOT NULL,
	`unidade` text NOT NULL,
	`custo_unitario_centavos` integer NOT NULL,
	`tipo` text NOT NULL,
	FOREIGN KEY (`competencia_id`) REFERENCES `sinapi_competencias`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_sinapi_itens_competencia_codigo` ON `sinapi_itens` (`competencia_id`,`codigo`);--> statement-breakpoint
CREATE INDEX `idx_sinapi_itens_descricao` ON `sinapi_itens` (`competencia_id`,`descricao`);