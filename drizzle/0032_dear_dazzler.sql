CREATE TABLE `goinfra_sync` (
	`id` integer PRIMARY KEY NOT NULL,
	`lock_token` text,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`last_checked` integer,
	`last_result_json` text,
	`last_error` text
);
