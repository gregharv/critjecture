CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  route_key TEXT NOT NULL,
  route_group TEXT NOT NULL,
  method TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status_code INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  model_name TEXT,
  tool_name TEXT,
  sandbox_run_id TEXT,
  total_tokens INTEGER,
  total_cost_usd REAL,
  duration_ms INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS request_logs_request_id_idx
  ON request_logs(request_id);

CREATE INDEX IF NOT EXISTS request_logs_route_group_started_at_idx
  ON request_logs(route_group, started_at);

CREATE INDEX IF NOT EXISTS request_logs_organization_id_started_at_idx
  ON request_logs(organization_id, started_at);

CREATE INDEX IF NOT EXISTS request_logs_user_id_started_at_idx
  ON request_logs(user_id, started_at);

CREATE INDEX IF NOT EXISTS request_logs_status_code_started_at_idx
  ON request_logs(status_code, started_at);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  route_key TEXT NOT NULL,
  route_group TEXT NOT NULL,
  event_type TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject_name TEXT,
  status TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_events_route_group_created_at_idx
  ON usage_events(route_group, created_at);

CREATE INDEX IF NOT EXISTS usage_events_organization_id_created_at_idx
  ON usage_events(organization_id, created_at);

CREATE INDEX IF NOT EXISTS usage_events_user_id_created_at_idx
  ON usage_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS usage_events_event_type_created_at_idx
  ON usage_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id TEXT PRIMARY KEY,
  route_group TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  bucket_start_at INTEGER NOT NULL,
  bucket_width_seconds INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_buckets_scope_bucket_idx
  ON rate_limit_buckets(route_group, scope_type, scope_id, bucket_start_at, bucket_width_seconds);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_at_idx
  ON rate_limit_buckets(updated_at);

CREATE TABLE IF NOT EXISTS operational_alerts (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS operational_alerts_dedupe_key_idx
  ON operational_alerts(dedupe_key);

CREATE INDEX IF NOT EXISTS operational_alerts_status_last_seen_at_idx
  ON operational_alerts(status, last_seen_at);

CREATE INDEX IF NOT EXISTS operational_alerts_organization_id_last_seen_at_idx
  ON operational_alerts(organization_id, last_seen_at);
