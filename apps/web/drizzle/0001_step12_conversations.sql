CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  title TEXT NOT NULL,
  preview_text TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  usage_json TEXT NOT NULL,
  session_data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT conversations_user_role_check CHECK (user_role in ('intern', 'owner'))
);

CREATE INDEX IF NOT EXISTS conversations_organization_id_updated_at_idx
  ON conversations(organization_id, updated_at);

CREATE INDEX IF NOT EXISTS conversations_user_id_updated_at_idx
  ON conversations(user_id, updated_at);

CREATE INDEX IF NOT EXISTS conversations_user_role_idx
  ON conversations(user_role);
