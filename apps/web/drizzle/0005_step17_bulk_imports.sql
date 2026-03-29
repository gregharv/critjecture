CREATE TABLE IF NOT EXISTS knowledge_import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  access_scope TEXT NOT NULL CHECK (access_scope IN ('public', 'admin')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('single_file', 'directory', 'zip')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed')),
  total_file_count INTEGER NOT NULL DEFAULT 0,
  queued_file_count INTEGER NOT NULL DEFAULT 0,
  running_file_count INTEGER NOT NULL DEFAULT 0,
  ready_file_count INTEGER NOT NULL DEFAULT 0,
  failed_file_count INTEGER NOT NULL DEFAULT 0,
  retryable_failed_file_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS knowledge_import_jobs_org_created_at_idx
  ON knowledge_import_jobs(organization_id, created_at);

CREATE INDEX IF NOT EXISTS knowledge_import_jobs_org_status_updated_at_idx
  ON knowledge_import_jobs(organization_id, status, updated_at);

CREATE INDEX IF NOT EXISTS knowledge_import_jobs_created_by_user_id_idx
  ON knowledge_import_jobs(created_by_user_id);

CREATE TABLE IF NOT EXISTS knowledge_import_job_files (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES knowledge_import_jobs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  relative_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  content_sha256 TEXT,
  archive_entry_path TEXT,
  staging_storage_path TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('queued', 'validating', 'extracting', 'chunking', 'indexing', 'ready', 'retryable_failed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_import_job_files_job_relative_path_idx
  ON knowledge_import_job_files(job_id, relative_path);

CREATE INDEX IF NOT EXISTS knowledge_import_job_files_org_stage_updated_at_idx
  ON knowledge_import_job_files(organization_id, stage, updated_at);

CREATE INDEX IF NOT EXISTS knowledge_import_job_files_job_stage_updated_at_idx
  ON knowledge_import_job_files(job_id, stage, updated_at);
