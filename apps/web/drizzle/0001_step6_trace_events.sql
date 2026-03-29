ALTER TABLE tool_calls
  ADD COLUMN accessed_files_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL,
  message_title TEXT NOT NULL,
  message_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS assistant_messages_turn_id_created_at_idx
  ON assistant_messages(turn_id, created_at DESC);
