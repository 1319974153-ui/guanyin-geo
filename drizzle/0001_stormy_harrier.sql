CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`digest` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes` text NOT NULL,
	`brands` text NOT NULL,
	`daily_limit` integer NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`revoked` text,
	`last_used` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_digest_unique` ON `api_keys` (`digest`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_owner` ON `api_keys` (`owner`);--> statement-breakpoint
CREATE TABLE `api_usage` (
	`key_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key_id`, `day`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`status` integer NOT NULL,
	`detail` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_owner_created` ON `audit_events` (`owner`,`created`);--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`label` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_backups_owner_created` ON `backups` (`owner`,`created`);--> statement-breakpoint
CREATE TABLE `members` (
	`owner` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`brands` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `email`)
);
--> statement-breakpoint
CREATE INDEX `idx_members_email` ON `members` (`email`);--> statement-breakpoint
CREATE TABLE `policies` (
	`owner` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`updated` text NOT NULL
);
