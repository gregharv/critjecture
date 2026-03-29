ALTER TABLE tool_calls
  ADD COLUMN sandbox_run_id TEXT;

CREATE INDEX IF NOT EXISTS tool_calls_sandbox_run_id_idx
  ON tool_calls(sandbox_run_id);

ALTER TABLE sandbox_runs
  ADD COLUMN turn_id TEXT REFERENCES chat_turns(id) ON DELETE SET NULL;

ALTER TABLE sandbox_runs
  ADD COLUMN runtime_tool_call_id TEXT;

ALTER TABLE sandbox_runs
  ADD COLUMN runner TEXT NOT NULL DEFAULT 'bubblewrap';

ALTER TABLE sandbox_runs
  ADD COLUMN status TEXT NOT NULL DEFAULT 'running'
  CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'rejected', 'abandoned'));

ALTER TABLE sandbox_runs
  ADD COLUMN failure_reason TEXT;

ALTER TABLE sandbox_runs
  ADD COLUMN exit_code INTEGER;

ALTER TABLE sandbox_runs
  ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN cpu_limit_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN memory_limit_bytes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN max_processes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN stdout_max_bytes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN artifact_max_bytes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN artifact_ttl_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN cleanup_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (cleanup_status IN ('pending', 'completed', 'failed', 'skipped'));

ALTER TABLE sandbox_runs
  ADD COLUMN cleanup_completed_at INTEGER;

ALTER TABLE sandbox_runs
  ADD COLUMN cleanup_error TEXT;

ALTER TABLE sandbox_runs
  ADD COLUMN started_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sandbox_runs
  ADD COLUMN completed_at INTEGER;

UPDATE sandbox_runs
SET
  started_at = CASE
    WHEN started_at = 0 THEN created_at
    ELSE started_at
  END,
  completed_at = CASE
    WHEN completed_at IS NULL THEN created_at
    ELSE completed_at
  END,
  status = CASE
    WHEN status = 'running' THEN 'completed'
    ELSE status
  END,
  cleanup_status = CASE
    WHEN cleanup_status = 'pending' THEN 'skipped'
    ELSE cleanup_status
  END;

CREATE INDEX IF NOT EXISTS sandbox_runs_status_started_at_idx
  ON sandbox_runs(status, started_at);

CREATE INDEX IF NOT EXISTS sandbox_runs_turn_id_started_at_idx
  ON sandbox_runs(turn_id, started_at);

CREATE TABLE IF NOT EXISTS sandbox_generated_assets (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES sandbox_runs(run_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS sandbox_generated_assets_run_path_idx
  ON sandbox_generated_assets(run_id, relative_path);

CREATE INDEX IF NOT EXISTS sandbox_generated_assets_run_id_idx
  ON sandbox_generated_assets(run_id);

CREATE INDEX IF NOT EXISTS sandbox_generated_assets_expires_at_idx
  ON sandbox_generated_assets(expires_at);
