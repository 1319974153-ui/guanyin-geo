CREATE TABLE `model_budgets` (
	`owner` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_spend` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`day` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`state` text NOT NULL,
	`micros` integer NOT NULL,
	`reserved` integer NOT NULL,
	`rate` text NOT NULL,
	`usage` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_spend_owner_day` ON `model_spend` (`owner`,`day`);