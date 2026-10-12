CREATE TABLE `report_snapshots` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source_revision` integer NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_reports_owner_brand` ON `report_snapshots` (`owner`,`brand_id`,`created`);