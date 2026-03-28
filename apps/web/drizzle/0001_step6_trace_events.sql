ALTER TABLE audit_tool_calls
  ADD COLUMN accessed_files_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS audit_trace_events (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'assistant-text',
      'assistant-thinking',
      'assistant-tool-plan',
      'tool-call',
      'tool-result'
    )
  ),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (prompt_id) REFERENCES audit_prompts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS audit_trace_events_prompt_id_created_at_idx
  ON audit_trace_events(prompt_id, created_at DESC);
