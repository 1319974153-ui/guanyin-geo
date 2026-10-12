CREATE TABLE `webhook_configs` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`name` text NOT NULL,
	`endpoint_label` text NOT NULL,
	`secret` text NOT NULL,
	`types` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`enqueue_token` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_configs_owner` ON `webhook_configs` (`owner`,`brand_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`hook_id` text NOT NULL,
	`hook_revision` integer NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` text,
	`lease_token` text,
	`lease_until` text,
	`http_status` integer,
	`error` text,
	`history` text DEFAULT '[]' NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhook_delivery_event` ON `webhook_deliveries` (`owner`,`hook_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_delivery_due` ON `webhook_deliveries` (`owner`,`state`,`next_at`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`brand_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhook_event_identity` ON `webhook_events` (`owner`,`id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_events_owner_seq` ON `webhook_events` (`owner`,`brand_id`,`seq`);
--> statement-breakpoint
CREATE TRIGGER `webhook_task_insert` AFTER INSERT ON `task_items`
WHEN (NEW.status IN ('complete','failed','uncertain')) AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=NEW.owner AND exclusive=1 AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN
 INSERT OR IGNORE INTO webhook_events(id,owner,brand_id,type,payload,created)
 VALUES('task:'||NEW.id||':'||NEW.attempts||':'||NEW.status||':'||NEW.updated,NEW.owner,NEW.brand_id,'task.'||NEW.status,json_object('schema',1,'id','task:'||NEW.id||':'||NEW.attempts||':'||NEW.status||':'||NEW.updated,'type','task.'||NEW.status,'occurredAt',NEW.updated,'brandId',NEW.brand_id,'resource',json_object('id',NEW.id,'kind','task_items','status',NEW.status),'attempt',NEW.attempts,'planId',NEW.plan_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

--> statement-breakpoint
CREATE TRIGGER `webhook_task_update` AFTER UPDATE ON `task_items`
WHEN (NEW.status IN ('complete','failed','uncertain') AND OLD.status<>NEW.status) AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=NEW.owner AND exclusive=1 AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN
 INSERT OR IGNORE INTO webhook_events(id,owner,brand_id,type,payload,created)
 VALUES('task:'||NEW.id||':'||NEW.attempts||':'||NEW.status||':'||NEW.updated,NEW.owner,NEW.brand_id,'task.'||NEW.status,json_object('schema',1,'id','task:'||NEW.id||':'||NEW.attempts||':'||NEW.status||':'||NEW.updated,'type','task.'||NEW.status,'occurredAt',NEW.updated,'brandId',NEW.brand_id,'resource',json_object('id',NEW.id,'kind','task_items','status',NEW.status),'attempt',NEW.attempts,'planId',NEW.plan_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

--> statement-breakpoint
CREATE TRIGGER `webhook_report` AFTER INSERT ON `report_snapshots`
WHEN (1) AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=NEW.owner AND exclusive=1 AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN
 INSERT OR IGNORE INTO webhook_events(id,owner,brand_id,type,payload,created)
 VALUES('report:'||NEW.id,NEW.owner,NEW.brand_id,'report.created',json_object('schema',1,'id','report:'||NEW.id,'type','report.created','occurredAt',NEW.created,'brandId',NEW.brand_id,'resource',json_object('id',NEW.id,'kind','report_snapshots','status','created')),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

--> statement-breakpoint
CREATE TRIGGER `webhook_publication` AFTER INSERT ON `publication_checks`
WHEN (1) AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=NEW.owner AND exclusive=1 AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN
 INSERT OR IGNORE INTO webhook_events(id,owner,brand_id,type,payload,created)
 VALUES('publication:'||NEW.id,NEW.owner,NEW.brand_id,'publication.checked',json_object('schema',1,'id','publication:'||NEW.id,'type','publication.checked','occurredAt',NEW.created,'brandId',NEW.brand_id,'resource',json_object('id',NEW.id,'kind','publication_checks','status','checked'),'publicationId',NEW.publication_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

--> statement-breakpoint
CREATE TRIGGER `webhook_alert_insert` AFTER INSERT ON `operation_records`
WHEN (NEW.kind='alert' AND json_extract(NEW.body,'$.status')='待处理') AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=NEW.owner AND exclusive=1 AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN
 INSERT OR IGNORE INTO webhook_events(id,owner,brand_id,type,payload,created)
 VALUES('alert:'||NEW.id||':'||NEW.revision||':'||NEW.updated,NEW.owner,NEW.brand_id,'alert.opened',json_object('schema',1,'id','alert:'||NEW.id||':'||NEW.revision||':'||NEW.updated,'type','alert.opened','occurredAt',NEW.updated,'brandId',NEW.brand_id,'resource',json_object('id',NEW.id,'kind','operation_records','status','open')),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

--> statement-breakpoint
CREATE TRIGGER `webhook_alert_update` AFTER UPDATE ON `operation_records`
WHEN (NEW.kind='alert' AND json_extract(NEW.body,'$.status')='待处理' AND (json_extract(OLD.body,'$.status') IS NOT '待处理' OR json_extract(OLD.body,'$.fingerprint') IS NOT json_extract(NEW.body,'$.fingerprint'))) AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=NEW.owner AND exclusive=1 AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN
 INSERT OR IGNORE INTO webhook_events(id,owner,brand_id,type,payload,created)
 VALUES('alert:'||NEW.id||':'||NEW.revision||':'||NEW.updated,NEW.owner,NEW.brand_id,'alert.opened',json_object('schema',1,'id','alert:'||NEW.id||':'||NEW.revision||':'||NEW.updated,'type','alert.opened','occurredAt',NEW.updated,'brandId',NEW.brand_id,'resource',json_object('id',NEW.id,'kind','operation_records','status','open')),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
