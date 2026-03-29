CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx
  ON organizations(slug);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('intern', 'owner')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_org_user_idx
  ON organization_memberships(organization_id, user_id);

CREATE INDEX IF NOT EXISTS organization_memberships_user_id_idx
  ON organization_memberships(user_id);

ALTER TABLE chat_turns
  ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_turns_organization_id_created_at_idx
  ON chat_turns(organization_id, created_at DESC);

ALTER TABLE sandbox_runs
  ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sandbox_runs_organization_id_created_at_idx
  ON sandbox_runs(organization_id, created_at DESC);
