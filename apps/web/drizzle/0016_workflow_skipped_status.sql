PRAGMA foreign_keys=OFF;

ALTER TABLE workflow_run_steps RENAME TO workflow_run_steps_old;
ALTER TABLE workflow_run_input_checks RENAME TO workflow_run_input_checks_old;
ALTER TABLE workflow_run_resolved_inputs RENAME TO workflow_run_resolved_inputs_old;
ALTER TABLE workflow_input_requests RENAME TO workflow_input_requests_old;
ALTER TABLE workflow_deliveries RENAME TO workflow_deliveries_old;
ALTER TABLE workflow_runs RENAME TO workflow_runs_old;

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'scheduled', 'resume')),
  trigger_window_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting_for_input', 'blocked_validation', 'completed', 'failed', 'cancelled', 'skipped')),
  run_as_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  run_as_role TEXT NOT NULL CHECK (run_as_role IN ('member', 'admin', 'owner')),
  started_at INTEGER,
  completed_at INTEGER,
  failure_reason TEXT,
  request_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (trigger_kind = 'scheduled' AND trigger_window_key IS NOT NULL)
    OR (trigger_kind IN ('manual', 'resume') AND trigger_window_key IS NULL)
  )
);

CREATE TABLE workflow_run_steps (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  sandbox_run_id TEXT REFERENCES sandbox_runs(run_id) ON DELETE SET NULL,
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workflow_run_input_checks (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  input_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  report_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workflow_run_resolved_inputs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  input_key TEXT NOT NULL,
  input_item_index INTEGER NOT NULL DEFAULT 0,
  asset_id TEXT NOT NULL REFERENCES data_assets(id) ON DELETE CASCADE,
  asset_version_id TEXT NOT NULL REFERENCES data_asset_versions(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  schema_hash TEXT,
  materialized_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workflow_input_requests (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'sent', 'fulfilled', 'expired', 'cancelled')),
  requested_input_keys_json TEXT NOT NULL DEFAULT '[]',
  notification_channels_json TEXT NOT NULL DEFAULT '[]',
  message TEXT,
  sent_at INTEGER,
  fulfilled_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workflow_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_kind TEXT NOT NULL
    CHECK (channel_kind IN ('webhook', 'chart_pack', 'ranked_table', 'generated_document', 'email')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_number INTEGER NOT NULL DEFAULT 1,
  payload_snapshot_json TEXT NOT NULL,
  artifact_manifest_json TEXT NOT NULL DEFAULT '[]',
  response_status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  next_retry_at INTEGER,
  sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO workflow_runs (
  id,
  workflow_id,
  workflow_version_id,
  organization_id,
  trigger_kind,
  trigger_window_key,
  status,
  run_as_user_id,
  run_as_role,
  started_at,
  completed_at,
  failure_reason,
  request_id,
  metadata_json,
  created_at,
  updated_at
)
SELECT
  id,
  workflow_id,
  workflow_version_id,
  organization_id,
  trigger_kind,
  trigger_window_key,
  status,
  run_as_user_id,
  run_as_role,
  started_at,
  completed_at,
  failure_reason,
  request_id,
  metadata_json,
  created_at,
  updated_at
FROM workflow_runs_old;

INSERT INTO workflow_run_steps (
  id,
  run_id,
  organization_id,
  step_key,
  step_order,
  tool_name,
  status,
  input_json,
  output_json,
  sandbox_run_id,
  started_at,
  completed_at,
  error_message,
  created_at,
  updated_at
)
SELECT
  id,
  run_id,
  organization_id,
  step_key,
  step_order,
  tool_name,
  status,
  input_json,
  output_json,
  sandbox_run_id,
  started_at,
  completed_at,
  error_message,
  created_at,
  updated_at
FROM workflow_run_steps_old;

INSERT INTO workflow_run_input_checks (
  id,
  run_id,
  organization_id,
  input_key,
  status,
  report_json,
  created_at,
  updated_at
)
SELECT
  id,
  run_id,
  organization_id,
  input_key,
  status,
  report_json,
  created_at,
  updated_at
FROM workflow_run_input_checks_old;

INSERT INTO workflow_run_resolved_inputs (
  id,
  run_id,
  organization_id,
  input_key,
  input_item_index,
  asset_id,
  asset_version_id,
  content_hash,
  schema_hash,
  materialized_path,
  display_name,
  resolved_at,
  metadata_json,
  created_at,
  updated_at
)
SELECT
  id,
  run_id,
  organization_id,
  input_key,
  input_item_index,
  asset_id,
  asset_version_id,
  content_hash,
  schema_hash,
  materialized_path,
  display_name,
  resolved_at,
  metadata_json,
  created_at,
  updated_at
FROM workflow_run_resolved_inputs_old;

INSERT INTO workflow_input_requests (
  id,
  run_id,
  workflow_id,
  organization_id,
  status,
  requested_input_keys_json,
  notification_channels_json,
  message,
  sent_at,
  fulfilled_at,
  expires_at,
  created_at,
  updated_at
)
SELECT
  id,
  run_id,
  workflow_id,
  organization_id,
  status,
  requested_input_keys_json,
  notification_channels_json,
  message,
  sent_at,
  fulfilled_at,
  expires_at,
  created_at,
  updated_at
FROM workflow_input_requests_old;

INSERT INTO workflow_deliveries (
  id,
  run_id,
  workflow_id,
  organization_id,
  channel_kind,
  status,
  attempt_number,
  payload_snapshot_json,
  artifact_manifest_json,
  response_status_code,
  response_body,
  error_message,
  next_retry_at,
  sent_at,
  created_at,
  updated_at
)
SELECT
  id,
  run_id,
  workflow_id,
  organization_id,
  channel_kind,
  status,
  attempt_number,
  payload_snapshot_json,
  artifact_manifest_json,
  response_status_code,
  response_body,
  error_message,
  next_retry_at,
  sent_at,
  created_at,
  updated_at
FROM workflow_deliveries_old;

DROP TABLE workflow_deliveries_old;
DROP TABLE workflow_input_requests_old;
DROP TABLE workflow_run_resolved_inputs_old;
DROP TABLE workflow_run_input_checks_old;
DROP TABLE workflow_run_steps_old;
DROP TABLE workflow_runs_old;

CREATE UNIQUE INDEX workflow_runs_scheduled_window_unique_idx
  ON workflow_runs(workflow_id, trigger_kind, trigger_window_key);
CREATE INDEX workflow_runs_workflow_id_created_at_idx
  ON workflow_runs(workflow_id, created_at);
CREATE INDEX workflow_runs_org_status_created_at_idx
  ON workflow_runs(organization_id, status, created_at);
CREATE INDEX workflow_runs_status_updated_at_idx
  ON workflow_runs(status, updated_at);
CREATE INDEX workflow_runs_trigger_window_key_idx
  ON workflow_runs(trigger_window_key);
CREATE INDEX workflow_runs_run_as_user_id_created_at_idx
  ON workflow_runs(run_as_user_id, created_at);
CREATE INDEX workflow_runs_request_id_idx
  ON workflow_runs(request_id);

CREATE UNIQUE INDEX workflow_run_steps_run_id_step_key_idx
  ON workflow_run_steps(run_id, step_key);
CREATE INDEX workflow_run_steps_run_id_step_order_idx
  ON workflow_run_steps(run_id, step_order);
CREATE INDEX workflow_run_steps_run_id_status_idx
  ON workflow_run_steps(run_id, status);
CREATE INDEX workflow_run_steps_sandbox_run_id_idx
  ON workflow_run_steps(sandbox_run_id);

CREATE UNIQUE INDEX workflow_run_input_checks_run_id_input_key_idx
  ON workflow_run_input_checks(run_id, input_key);
CREATE INDEX workflow_run_input_checks_run_id_status_idx
  ON workflow_run_input_checks(run_id, status);
CREATE INDEX workflow_run_input_checks_org_created_at_idx
  ON workflow_run_input_checks(organization_id, created_at);

CREATE UNIQUE INDEX workflow_run_resolved_inputs_run_id_input_item_idx
  ON workflow_run_resolved_inputs(run_id, input_key, input_item_index);
CREATE INDEX workflow_run_resolved_inputs_run_id_input_key_idx
  ON workflow_run_resolved_inputs(run_id, input_key);
CREATE INDEX workflow_run_resolved_inputs_run_id_idx
  ON workflow_run_resolved_inputs(run_id);
CREATE INDEX workflow_run_resolved_inputs_asset_version_id_idx
  ON workflow_run_resolved_inputs(asset_version_id);
CREATE INDEX workflow_run_resolved_inputs_org_created_at_idx
  ON workflow_run_resolved_inputs(organization_id, created_at);

CREATE INDEX workflow_input_requests_run_id_status_updated_at_idx
  ON workflow_input_requests(run_id, status, updated_at);
CREATE INDEX workflow_input_requests_org_status_updated_at_idx
  ON workflow_input_requests(organization_id, status, updated_at);
CREATE INDEX workflow_input_requests_status_expires_at_idx
  ON workflow_input_requests(status, expires_at);

CREATE UNIQUE INDEX workflow_deliveries_run_id_channel_attempt_idx
  ON workflow_deliveries(run_id, channel_kind, attempt_number);
CREATE INDEX workflow_deliveries_run_id_created_at_idx
  ON workflow_deliveries(run_id, created_at);
CREATE INDEX workflow_deliveries_org_status_next_retry_at_idx
  ON workflow_deliveries(organization_id, status, next_retry_at);
CREATE INDEX workflow_deliveries_status_created_at_idx
  ON workflow_deliveries(status, created_at);

PRAGMA foreign_keys=ON;
