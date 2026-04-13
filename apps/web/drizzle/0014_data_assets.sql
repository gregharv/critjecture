CREATE TABLE data_assets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  access_scope TEXT NOT NULL DEFAULT 'admin'
    CHECK (access_scope IN ('public', 'admin')),
  data_kind TEXT NOT NULL DEFAULT 'text_document'
    CHECK (data_kind IN ('table', 'text_document', 'pdf', 'spreadsheet')),
  active_version_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE data_asset_versions (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES data_assets(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_modified_at INTEGER,
  content_hash TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  materialized_path TEXT NOT NULL,
  ingestion_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ingestion_status IN ('pending', 'ready', 'failed')),
  ingestion_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workflow_run_resolved_inputs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  input_key TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES data_assets(id) ON DELETE CASCADE,
  asset_version_id TEXT NOT NULL REFERENCES data_asset_versions(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  materialized_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX data_assets_org_asset_key_idx
  ON data_assets(organization_id, asset_key);

CREATE INDEX data_assets_org_scope_updated_at_idx
  ON data_assets(organization_id, access_scope, updated_at);

CREATE INDEX data_assets_active_version_id_idx
  ON data_assets(active_version_id);

CREATE INDEX data_asset_versions_asset_created_at_idx
  ON data_asset_versions(asset_id, created_at);

CREATE INDEX data_asset_versions_asset_content_hash_idx
  ON data_asset_versions(asset_id, content_hash);

CREATE INDEX data_asset_versions_org_ingestion_status_updated_at_idx
  ON data_asset_versions(organization_id, ingestion_status, updated_at);

CREATE INDEX workflow_run_resolved_inputs_run_id_input_key_idx
  ON workflow_run_resolved_inputs(run_id, input_key);

CREATE INDEX workflow_run_resolved_inputs_asset_version_id_idx
  ON workflow_run_resolved_inputs(asset_version_id);

CREATE INDEX workflow_run_resolved_inputs_org_created_at_idx
  ON workflow_run_resolved_inputs(organization_id, created_at);
