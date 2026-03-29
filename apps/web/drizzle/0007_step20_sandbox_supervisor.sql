ALTER TABLE sandbox_runs
  ADD COLUMN backend TEXT NOT NULL DEFAULT 'local_supervisor'
  CHECK (backend IN ('local_supervisor', 'hosted_supervisor'));

ALTER TABLE sandbox_runs
  ADD COLUMN code_text TEXT NOT NULL DEFAULT '';

ALTER TABLE sandbox_runs
  ADD COLUMN input_files_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE sandbox_runs
  ADD COLUMN stdout_text TEXT;

ALTER TABLE sandbox_runs
  ADD COLUMN stderr_text TEXT;

ALTER TABLE sandbox_runs
  ADD COLUMN supervisor_id TEXT;

ALTER TABLE sandbox_runs
  ADD COLUMN lease_expires_at INTEGER;

ALTER TABLE sandbox_runs
  ADD COLUMN last_heartbeat_at INTEGER;

ALTER TABLE sandbox_runs
  ADD COLUMN workspace_path TEXT;

ALTER TABLE sandbox_runs
  ADD COLUMN cleanup_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN reconciliation_count INTEGER NOT NULL DEFAULT 0;

UPDATE sandbox_runs
SET
  backend = 'local_supervisor',
  code_text = '',
  input_files_json = '[]'
WHERE backend = 'local_supervisor';

CREATE TABLE sandbox_runs_step20 (
  run_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES chat_turns(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  runtime_tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  backend TEXT NOT NULL DEFAULT 'local_supervisor'
    CHECK (backend IN ('local_supervisor', 'hosted_supervisor')),
  runner TEXT NOT NULL DEFAULT 'bubblewrap',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'starting', 'running', 'finalizing', 'completed', 'failed', 'timed_out', 'rejected', 'abandoned')),
  failure_reason TEXT,
  exit_code INTEGER,
  timeout_ms INTEGER NOT NULL DEFAULT 0,
  cpu_limit_seconds INTEGER NOT NULL DEFAULT 0,
  memory_limit_bytes INTEGER NOT NULL DEFAULT 0,
  max_processes INTEGER NOT NULL DEFAULT 0,
  stdout_max_bytes INTEGER NOT NULL DEFAULT 0,
  artifact_max_bytes INTEGER NOT NULL DEFAULT 0,
  artifact_ttl_ms INTEGER NOT NULL DEFAULT 0,
  code_text TEXT NOT NULL DEFAULT '',
  input_files_json TEXT NOT NULL DEFAULT '[]',
  stdout_text TEXT,
  stderr_text TEXT,
  supervisor_id TEXT,
  lease_expires_at INTEGER,
  last_heartbeat_at INTEGER,
  workspace_path TEXT,
  cleanup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (cleanup_status IN ('pending', 'completed', 'failed', 'skipped')),
  cleanup_completed_at INTEGER,
  cleanup_error TEXT,
  cleanup_attempt_count INTEGER NOT NULL DEFAULT 0,
  reconciliation_count INTEGER NOT NULL DEFAULT 0,
  generated_assets_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER
);

INSERT INTO sandbox_runs_step20 (
  run_id,
  organization_id,
  turn_id,
  user_id,
  runtime_tool_call_id,
  tool_name,
  backend,
  runner,
  status,
  failure_reason,
  exit_code,
  timeout_ms,
  cpu_limit_seconds,
  memory_limit_bytes,
  max_processes,
  stdout_max_bytes,
  artifact_max_bytes,
  artifact_ttl_ms,
  code_text,
  input_files_json,
  stdout_text,
  stderr_text,
  supervisor_id,
  lease_expires_at,
  last_heartbeat_at,
  workspace_path,
  cleanup_status,
  cleanup_completed_at,
  cleanup_error,
  cleanup_attempt_count,
  reconciliation_count,
  generated_assets_json,
  created_at,
  started_at,
  completed_at
)
SELECT
  run_id,
  organization_id,
  turn_id,
  user_id,
  runtime_tool_call_id,
  tool_name,
  backend,
  runner,
  CASE
    WHEN status = 'running' THEN 'completed'
    ELSE status
  END,
  failure_reason,
  exit_code,
  timeout_ms,
  cpu_limit_seconds,
  memory_limit_bytes,
  max_processes,
  stdout_max_bytes,
  artifact_max_bytes,
  artifact_ttl_ms,
  code_text,
  input_files_json,
  stdout_text,
  stderr_text,
  supervisor_id,
  lease_expires_at,
  last_heartbeat_at,
  workspace_path,
  CASE
    WHEN cleanup_status = 'pending' AND status != 'running' THEN 'skipped'
    ELSE cleanup_status
  END,
  cleanup_completed_at,
  cleanup_error,
  cleanup_attempt_count,
  reconciliation_count,
  generated_assets_json,
  created_at,
  started_at,
  completed_at
FROM sandbox_runs;

DROP TABLE sandbox_runs;

ALTER TABLE sandbox_runs_step20
  RENAME TO sandbox_runs;

CREATE INDEX IF NOT EXISTS sandbox_runs_user_id_created_at_idx
  ON sandbox_runs(user_id, created_at);

CREATE INDEX IF NOT EXISTS sandbox_runs_organization_id_created_at_idx
  ON sandbox_runs(organization_id, created_at);

CREATE INDEX IF NOT EXISTS sandbox_runs_backend_status_created_at_idx
  ON sandbox_runs(backend, status, created_at);

CREATE INDEX IF NOT EXISTS sandbox_runs_status_lease_expires_at_idx
  ON sandbox_runs(status, lease_expires_at);

CREATE INDEX IF NOT EXISTS sandbox_runs_status_started_at_idx
  ON sandbox_runs(status, started_at);

CREATE INDEX IF NOT EXISTS sandbox_runs_turn_id_started_at_idx
  ON sandbox_runs(turn_id, started_at);
