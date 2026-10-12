CREATE TABLE `task_items` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`plan_id` text NOT NULL,
	`brand_id` text NOT NULL,
	`spec` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available` text NOT NULL,
	`lease_until` text,
	`lease_token` text,
	`result` text,
	`error` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_items_queue` ON `task_items` (`owner`,`status`,`available`);--> statement-breakpoint
CREATE INDEX `idx_items_plan` ON `task_items` (`owner`,`plan_id`);--> statement-breakpoint
CREATE TABLE `task_plans` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`spec` text NOT NULL,
	`status` text NOT NULL,
	`next_at` text,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_plans_due` ON `task_plans` (`owner`,`status`,`next_at`);