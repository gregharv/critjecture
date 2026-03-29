CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('intern', 'owner')),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_email_idx
  ON users(email);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx
  ON organizations(slug);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY NOT NULL,
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

CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  chat_session_id TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('intern', 'owner')),
  user_prompt_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS chat_turns_created_at_idx
  ON chat_turns(created_at);

CREATE INDEX IF NOT EXISTS chat_turns_chat_session_id_idx
  ON chat_turns(chat_session_id);

CREATE INDEX IF NOT EXISTS chat_turns_conversation_id_idx
  ON chat_turns(conversation_id);

CREATE INDEX IF NOT EXISTS chat_turns_organization_id_created_at_idx
  ON chat_turns(organization_id, created_at);

CREATE INDEX IF NOT EXISTS chat_turns_user_id_created_at_idx
  ON chat_turns(user_id, created_at);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('final-response', 'planner-selection')),
  message_text TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS assistant_messages_turn_id_message_index_idx
  ON assistant_messages(turn_id, message_index);

CREATE INDEX IF NOT EXISTS assistant_messages_turn_id_created_at_idx
  ON assistant_messages(turn_id, created_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL,
  runtime_tool_call_id TEXT NOT NULL UNIQUE,
  tool_name TEXT NOT NULL,
  tool_parameters_json TEXT NOT NULL,
  accessed_files_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'error')),
  result_summary TEXT,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tool_calls_turn_id_started_at_idx
  ON tool_calls(turn_id, started_at);

CREATE TABLE IF NOT EXISTS sandbox_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  generated_assets_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sandbox_runs_user_id_created_at_idx
  ON sandbox_runs(user_id, created_at);

CREATE INDEX IF NOT EXISTS sandbox_runs_organization_id_created_at_idx
  ON sandbox_runs(organization_id, created_at);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_type TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_indexed_at INTEGER,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS documents_org_source_path_idx
  ON documents(organization_id, source_path);

CREATE INDEX IF NOT EXISTS documents_organization_id_idx
  ON documents(organization_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  start_offset INTEGER,
  end_offset INTEGER,
  token_count INTEGER,
  content_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_document_chunk_index_idx
  ON document_chunks(document_id, chunk_index);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
  ON document_chunks(document_id);

CREATE TABLE IF NOT EXISTS retrieval_runs (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  embedding_model TEXT,
  rerank_model TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT,
  FOREIGN KEY (turn_id) REFERENCES chat_turns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS retrieval_runs_turn_id_started_at_idx
  ON retrieval_runs(turn_id, started_at);

CREATE TABLE IF NOT EXISTS retrieval_rewrites (
  id TEXT PRIMARY KEY NOT NULL,
  retrieval_run_id TEXT NOT NULL,
  rewrite_type TEXT NOT NULL CHECK (rewrite_type IN ('contextual-rewrite', 'hyde')),
  input_text TEXT NOT NULL,
  output_text TEXT NOT NULL,
  model_name TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (retrieval_run_id) REFERENCES retrieval_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS retrieval_rewrites_run_id_created_at_idx
  ON retrieval_rewrites(retrieval_run_id, created_at);

CREATE TABLE IF NOT EXISTS retrieval_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  retrieval_run_id TEXT NOT NULL,
  document_id TEXT REFERENCES documents(id),
  chunk_id TEXT REFERENCES document_chunks(id),
  bm25_score REAL,
  vector_score REAL,
  rrf_score REAL,
  rerank_score REAL,
  retrieval_rank INTEGER,
  rerank_rank INTEGER,
  selected_for_rerank INTEGER NOT NULL DEFAULT 0,
  selected_for_answer INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (retrieval_run_id) REFERENCES retrieval_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS retrieval_candidates_run_id_idx
  ON retrieval_candidates(retrieval_run_id);

CREATE INDEX IF NOT EXISTS retrieval_candidates_run_id_retrieval_rank_idx
  ON retrieval_candidates(retrieval_run_id, retrieval_rank);

CREATE INDEX IF NOT EXISTS retrieval_candidates_run_id_rerank_rank_idx
  ON retrieval_candidates(retrieval_run_id, rerank_rank);

CREATE TABLE IF NOT EXISTS response_citations (
  id TEXT PRIMARY KEY NOT NULL,
  assistant_message_id TEXT NOT NULL,
  retrieval_candidate_id TEXT NOT NULL,
  citation_index INTEGER NOT NULL,
  FOREIGN KEY (assistant_message_id) REFERENCES assistant_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (retrieval_candidate_id) REFERENCES retrieval_candidates(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS response_citations_message_citation_index_idx
  ON response_citations(assistant_message_id, citation_index);

CREATE INDEX IF NOT EXISTS response_citations_message_id_idx
  ON response_citations(assistant_message_id);

CREATE INDEX IF NOT EXISTS response_citations_candidate_id_idx
  ON response_citations(retrieval_candidate_id);
