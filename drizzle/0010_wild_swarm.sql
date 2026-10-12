CREATE TABLE `backup_schedules` (
	`owner` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`hours` integer DEFAULT 24 NOT NULL,
	`keep` integer DEFAULT 7 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`next_at` text,
	`lease_token` text,
	`lease_until` text,
	`pending_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_backup_id` text,
	`last_success` text,
	`last_error` text,
	`history` text DEFAULT '[]' NOT NULL,
	`request_id` text,
	`fingerprint` text,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `backups` ADD `kind` text DEFAULT 'manual' NOT NULL;