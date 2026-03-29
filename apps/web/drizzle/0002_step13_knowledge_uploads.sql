ALTER TABLE documents
  ADD COLUMN display_name TEXT NOT NULL DEFAULT '';

ALTER TABLE documents
  ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'admin'
  CHECK (access_scope IN ('public', 'admin'));

ALTER TABLE documents
  ADD COLUMN ingestion_status TEXT NOT NULL DEFAULT 'ready'
  CHECK (ingestion_status IN ('pending', 'ready', 'failed'));

ALTER TABLE documents
  ADD COLUMN ingestion_error TEXT;

ALTER TABLE documents
  ADD COLUMN uploaded_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_org_source_type_idx
  ON documents(organization_id, source_type);

CREATE INDEX IF NOT EXISTS documents_org_access_scope_idx
  ON documents(organization_id, access_scope);

CREATE INDEX IF NOT EXISTS documents_org_ingestion_status_idx
  ON documents(organization_id, ingestion_status);

CREATE INDEX IF NOT EXISTS documents_uploaded_by_user_id_idx
  ON documents(uploaded_by_user_id);
