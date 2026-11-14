CREATE TABLE `writing_budget_calls` (
	`owner` text NOT NULL,
	`budget_id` text NOT NULL,
	`stage` text NOT NULL,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`input_bound` integer NOT NULL,
	`output_bound` integer NOT NULL,
	`micros` integer NOT NULL,
	`usage` text,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `budget_id`, `stage`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_writing_budget_run` ON `writing_budget_calls` (`owner`,`run_id`);--> statement-breakpoint
CREATE TABLE `writing_budgets` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`brand_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`expires` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
