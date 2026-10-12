CREATE TABLE `backup_assets` (
	`owner` text NOT NULL,
	`backup_id` text NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`owner`, `backup_id`, `table_name`, `record_id`)
);
--> statement-breakpoint
CREATE TABLE `operation_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`exclusive` integer NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_operation_leases_owner` ON `operation_leases` (`owner`,`expires`);--> statement-breakpoint
CREATE TABLE `operation_records` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_operations_brand` ON `operation_records` (`owner`,`brand_id`,`kind`);