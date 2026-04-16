ALTER TABLE conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE conversations ADD COLUMN manual_title TEXT;

CREATE INDEX IF NOT EXISTS conversations_org_visibility_updated_at_idx
  ON conversations(organization_id, visibility, updated_at);

CREATE TABLE IF NOT EXISTS conversation_pins (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_pins_conversation_user_idx
  ON conversation_pins(conversation_id, user_id);

CREATE INDEX IF NOT EXISTS conversation_pins_org_user_updated_at_idx
  ON conversation_pins(organization_id, user_id, updated_at);

CREATE INDEX IF NOT EXISTS conversation_pins_conversation_id_idx
  ON conversation_pins(conversation_id);
