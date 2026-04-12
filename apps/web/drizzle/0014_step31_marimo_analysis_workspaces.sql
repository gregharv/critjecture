CREATE TABLE analysis_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'completed', 'failed')),
  latest_revision_id TEXT,
  latest_sandbox_run_id TEXT REFERENCES sandbox_runs(run_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE analysis_notebook_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES analysis_workspaces(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES chat_turns(id) ON DELETE SET NULL,
  revision_number INTEGER NOT NULL,
  notebook_source TEXT NOT NULL,
  notebook_path TEXT NOT NULL,
  html_export_path TEXT,
  structured_result_path TEXT,
  summary TEXT,
  sandbox_run_id TEXT REFERENCES sandbox_runs(run_id) ON DELETE SET NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'completed', 'failed', 'timed_out', 'rejected')),
  created_at INTEGER NOT NULL
);

CREATE TABLE analysis_preview_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES analysis_workspaces(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES analysis_notebook_revisions(id) ON DELETE CASCADE,
  sandbox_run_id TEXT REFERENCES sandbox_runs(run_id) ON DELETE SET NULL,
  preview_token_hash TEXT,
  preview_url TEXT,
  port INTEGER,
  status TEXT NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'ready', 'stopped', 'failed')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX analysis_workspaces_conversation_id_idx
  ON analysis_workspaces(conversation_id);

CREATE INDEX analysis_workspaces_org_updated_at_idx
  ON analysis_workspaces(organization_id, updated_at);

CREATE INDEX analysis_workspaces_user_updated_at_idx
  ON analysis_workspaces(user_id, updated_at);

CREATE INDEX analysis_workspaces_latest_sandbox_run_id_idx
  ON analysis_workspaces(latest_sandbox_run_id);

CREATE UNIQUE INDEX analysis_notebook_revisions_workspace_revision_number_idx
  ON analysis_notebook_revisions(workspace_id, revision_number);

CREATE INDEX analysis_notebook_revisions_workspace_created_at_idx
  ON analysis_notebook_revisions(workspace_id, created_at);

CREATE INDEX analysis_notebook_revisions_turn_id_idx
  ON analysis_notebook_revisions(turn_id);

CREATE INDEX analysis_notebook_revisions_sandbox_run_id_idx
  ON analysis_notebook_revisions(sandbox_run_id);

CREATE INDEX analysis_notebook_revisions_status_created_at_idx
  ON analysis_notebook_revisions(status, created_at);

CREATE UNIQUE INDEX analysis_preview_sessions_preview_token_hash_idx
  ON analysis_preview_sessions(preview_token_hash);

CREATE INDEX analysis_preview_sessions_workspace_updated_at_idx
  ON analysis_preview_sessions(workspace_id, updated_at);

CREATE INDEX analysis_preview_sessions_revision_created_at_idx
  ON analysis_preview_sessions(revision_id, created_at);

CREATE INDEX analysis_preview_sessions_status_expires_at_idx
  ON analysis_preview_sessions(status, expires_at);

CREATE INDEX analysis_preview_sessions_sandbox_run_id_idx
  ON analysis_preview_sessions(sandbox_run_id);
