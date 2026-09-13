CREATE TABLE `sinapi_sync` (
	`id` integer PRIMARY KEY NOT NULL,
	`config_json` text,
	`job_id` text,
	`lock_token` text,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`last_checked` integer,
	`last_error` text
);
--> statement-breakpoint
DROP INDEX `uidx_sinapi_itens_competencia_codigo`;--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_sinapi_itens_competencia_codigo` ON `sinapi_itens` (`competencia_id`,`tipo`,`codigo`);