CREATE TABLE IF NOT EXISTS audit_prompts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('intern', 'owner')),
  prompt_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL UNIQUE,
  tool_name TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'error')),
  result_summary TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (prompt_id) REFERENCES audit_prompts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS audit_prompts_created_at_idx
  ON audit_prompts(created_at DESC);

CREATE INDEX IF NOT EXISTS audit_tool_calls_prompt_id_created_at_idx
  ON audit_tool_calls(prompt_id, created_at DESC);
