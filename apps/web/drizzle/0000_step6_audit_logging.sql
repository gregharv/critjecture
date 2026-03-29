CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY NOT NULL,
  chat_session_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('intern', 'owner')),
  user_prompt_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL,
  runtime_tool_call_id TEXT NOT NULL UNIQUE,
  tool_name TEXT NOT NULL,
  tool_parameters_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'error')),
  result_summary TEXT,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS chat_turns_created_at_idx
  ON chat_turns(created_at DESC);

CREATE INDEX IF NOT EXISTS tool_calls_turn_id_started_at_idx
  ON tool_calls(turn_id, started_at DESC);
