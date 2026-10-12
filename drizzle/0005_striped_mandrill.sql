CREATE TABLE `publication_checks` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`body` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_publication_checks` ON `publication_checks` (`owner`,`brand_id`,`publication_id`,`created`);