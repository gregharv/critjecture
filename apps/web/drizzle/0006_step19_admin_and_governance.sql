ALTER TABLE users
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS users_status_idx
  ON users(status);

CREATE TABLE IF NOT EXISTS organization_compliance_settings (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_log_retention_days INTEGER,
  usage_retention_days INTEGER,
  alert_retention_days INTEGER,
  chat_history_retention_days INTEGER,
  knowledge_import_retention_days INTEGER,
  export_artifact_retention_days INTEGER NOT NULL DEFAULT 7,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_compliance_settings_org_idx
  ON organization_compliance_settings(organization_id);

CREATE INDEX IF NOT EXISTS organization_compliance_settings_updated_by_user_id_idx
  ON organization_compliance_settings(updated_by_user_id);

CREATE TABLE IF NOT EXISTS governance_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('organization_export', 'knowledge_delete', 'history_purge', 'import_metadata_purge')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  trigger_kind TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_kind IN ('manual', 'automatic')),
  target_label TEXT NOT NULL,
  cutoff_timestamp INTEGER,
  artifact_storage_path TEXT,
  artifact_file_name TEXT,
  artifact_byte_size INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS governance_jobs_org_created_at_idx
  ON governance_jobs(organization_id, created_at);

CREATE INDEX IF NOT EXISTS governance_jobs_org_status_updated_at_idx
  ON governance_jobs(organization_id, status, updated_at);

CREATE INDEX IF NOT EXISTS governance_jobs_requested_by_user_id_idx
  ON governance_jobs(requested_by_user_id);

CREATE INDEX IF NOT EXISTS governance_jobs_type_completed_at_idx
  ON governance_jobs(job_type, completed_at);
