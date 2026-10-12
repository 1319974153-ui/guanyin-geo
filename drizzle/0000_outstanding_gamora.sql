CREATE TABLE `connections` (
	`owner` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`secret` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`created` text NOT NULL,
	`result` text,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_runs_owner_created` ON `runs` (`owner`,`created`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated` text NOT NULL
);
