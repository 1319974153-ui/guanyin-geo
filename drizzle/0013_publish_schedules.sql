CREATE TABLE IF NOT EXISTS publish_schedules (
 owner TEXT NOT NULL,
 id TEXT NOT NULL,
 brand_id TEXT NOT NULL,
 state TEXT NOT NULL,
 due_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 body TEXT NOT NULL,
 created TEXT NOT NULL,
 updated TEXT NOT NULL,
 PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS publish_schedules_due ON publish_schedules(owner,state,due_at);
CREATE TABLE IF NOT EXISTS publish_schedule_attempts (
 owner TEXT NOT NULL,
 schedule_id TEXT NOT NULL,
 target_key TEXT NOT NULL,
 brand_id TEXT NOT NULL,
 platform TEXT NOT NULL,
 account_id TEXT NOT NULL,
 dispatch_id TEXT NOT NULL,
 state TEXT NOT NULL,
 started TEXT NOT NULL,
 body TEXT NOT NULL,
 PRIMARY KEY(owner,schedule_id,target_key),
 UNIQUE(owner,dispatch_id)
);
CREATE INDEX IF NOT EXISTS publish_schedule_quota ON publish_schedule_attempts(owner,platform,account_id,started);
