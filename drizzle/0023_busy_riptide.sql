CREATE TABLE `chat_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`name` text,
	`created_by_member_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_message_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_chat_channels_key` ON `chat_channels` (`organization_id`,`key`);--> statement-breakpoint
CREATE TABLE `chat_message_files` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `org_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_chat_message_files` ON `chat_message_files` (`message_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_message_files_file` ON `chat_message_files` (`organization_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`author_member_id` text NOT NULL,
	`author_name` text NOT NULL,
	`client_key` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'mensagem' NOT NULL,
	`created_at` text NOT NULL,
	`edited_at` text,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_chat_messages_client_key` ON `chat_messages` (`organization_id`,`author_member_id`,`client_key`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_channel` ON `chat_messages` (`organization_id`,`channel_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`member_id` text NOT NULL,
	`is_member` integer DEFAULT 0 NOT NULL,
	`last_read_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_chat_participants_member` ON `chat_participants` (`channel_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_participants_org_member` ON `chat_participants` (`organization_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `chat_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`created_by_member_id` text NOT NULL,
	`created_by_name` text NOT NULL,
	`target_member_id` text,
	`text` text NOT NULL,
	`due_day` text NOT NULL,
	`done_at` text,
	`done_by_name` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_chat_reminders_message` ON `chat_reminders` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_reminders_due` ON `chat_reminders` (`organization_id`,`done_at`,`due_day`);--> statement-breakpoint
CREATE TABLE `org_file_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `org_files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_org_file_chunks_part` ON `org_file_chunks` (`file_id`,`chunk_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_org_file_chunks_storage_key` ON `org_file_chunks` (`storage_key`);--> statement-breakpoint
CREATE TABLE `org_files` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`extension` text DEFAULT '' NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`chunk_size` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`in_library` integer DEFAULT 0 NOT NULL,
	`source_file_id` text,
	`conversion` text,
	`uploaded_by_member_id` text NOT NULL,
	`uploaded_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ready_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_org_files_library` ON `org_files` (`organization_id`,`in_library`,`status`);--> statement-breakpoint
CREATE INDEX `idx_org_files_source` ON `org_files` (`organization_id`,`source_file_id`,`conversion`);