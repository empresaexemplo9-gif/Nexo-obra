CREATE TABLE `goinfra_busca` (
	`id` integer PRIMARY KEY NOT NULL,
	`lock_token` text,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`last_checked_at` integer,
	`last_origin` text,
	`last_result` text,
	`last_error` text
);
