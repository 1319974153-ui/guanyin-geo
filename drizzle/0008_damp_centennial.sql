CREATE TABLE `backup_transfers` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`manifest_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`backup_id` text,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	`expires` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_backup_transfer_owner` ON `backup_transfers` (`owner`,`status`,`updated`);