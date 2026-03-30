CREATE TABLE sandbox_runs_step28 (
  run_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES chat_turns(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  runtime_tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  backend TEXT NOT NULL DEFAULT 'container_supervisor'
    CHECK (backend IN ('container_supervisor', 'local_supervisor', 'hosted_supervisor')),
  runner TEXT NOT NULL DEFAULT 'oci-container',
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
  inline_workspace_files_json TEXT NOT NULL DEFAULT '[]',
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

INSERT INTO sandbox_runs_step28 (
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
  inline_workspace_files_json,
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
  CASE
    WHEN backend = 'local_supervisor' THEN 'local_supervisor'
    WHEN backend = 'hosted_supervisor' THEN 'hosted_supervisor'
    ELSE 'container_supervisor'
  END,
  CASE
    WHEN backend = 'local_supervisor' THEN 'bubblewrap'
    WHEN backend = 'hosted_supervisor' THEN 'hosted-supervisor'
    ELSE COALESCE(NULLIF(runner, ''), 'oci-container')
  END,
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
  inline_workspace_files_json,
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
FROM sandbox_runs;

DROP TABLE sandbox_runs;

ALTER TABLE sandbox_runs_step28
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
