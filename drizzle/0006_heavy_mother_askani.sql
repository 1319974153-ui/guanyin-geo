CREATE TABLE `attribution_events` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`source_system` text NOT NULL,
	`external_id` text NOT NULL,
	`kind` text NOT NULL,
	`occurred_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attribution_external` ON `attribution_events` (`owner`,`brand_id`,`source_system`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_attribution_brand_date` ON `attribution_events` (`owner`,`brand_id`,`occurred_at`);