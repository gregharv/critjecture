ALTER TABLE request_logs
  ADD COLUMN turn_id TEXT;

ALTER TABLE request_logs
  ADD COLUMN runtime_tool_call_id TEXT;

ALTER TABLE request_logs
  ADD COLUMN governance_job_id TEXT;

ALTER TABLE request_logs
  ADD COLUMN knowledge_import_job_id TEXT;

CREATE INDEX IF NOT EXISTS request_logs_turn_id_started_at_idx
  ON request_logs(turn_id, started_at);

CREATE INDEX IF NOT EXISTS request_logs_governance_job_id_started_at_idx
  ON request_logs(governance_job_id, started_at);

CREATE INDEX IF NOT EXISTS request_logs_knowledge_import_job_id_started_at_idx
  ON request_logs(knowledge_import_job_id, started_at);

ALTER TABLE governance_jobs
  ADD COLUMN trigger_request_id TEXT;

CREATE INDEX IF NOT EXISTS governance_jobs_trigger_request_id_idx
  ON governance_jobs(trigger_request_id);

ALTER TABLE knowledge_import_jobs
  ADD COLUMN trigger_request_id TEXT;

CREATE INDEX IF NOT EXISTS knowledge_import_jobs_trigger_request_id_idx
  ON knowledge_import_jobs(trigger_request_id);
