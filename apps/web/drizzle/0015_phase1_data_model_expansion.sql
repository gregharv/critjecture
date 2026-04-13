CREATE TABLE data_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('filesystem', 'upload', 'bulk_import', 'google_drive', 'google_sheets', 's3')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'error')),
  config_json TEXT NOT NULL DEFAULT '{}',
  credentials_ref TEXT,
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX data_connections_org_kind_idx
  ON data_connections(organization_id, kind);

CREATE INDEX data_connections_org_status_updated_at_idx
  ON data_connections(organization_id, status, updated_at);

ALTER TABLE data_assets ADD COLUMN connection_id TEXT REFERENCES data_connections(id) ON DELETE SET NULL;
ALTER TABLE data_assets ADD COLUMN external_object_id TEXT;

CREATE INDEX data_assets_connection_external_object_idx
  ON data_assets(connection_id, external_object_id);

ALTER TABLE data_asset_versions ADD COLUMN source_version_token TEXT;
ALTER TABLE data_asset_versions ADD COLUMN schema_hash TEXT;
ALTER TABLE data_asset_versions ADD COLUMN row_count INTEGER;
ALTER TABLE data_asset_versions ADD COLUMN indexed_at INTEGER;

CREATE INDEX data_asset_versions_asset_materialized_path_idx
  ON data_asset_versions(asset_id, materialized_path);

ALTER TABLE workflow_run_resolved_inputs ADD COLUMN input_item_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_run_resolved_inputs ADD COLUMN schema_hash TEXT;

DROP INDEX workflow_run_resolved_inputs_run_id_input_key_idx;
CREATE UNIQUE INDEX workflow_run_resolved_inputs_run_id_input_item_idx
  ON workflow_run_resolved_inputs(run_id, input_key, input_item_index);
CREATE INDEX workflow_run_resolved_inputs_run_id_input_key_idx
  ON workflow_run_resolved_inputs(run_id, input_key);
CREATE INDEX workflow_run_resolved_inputs_run_id_idx
  ON workflow_run_resolved_inputs(run_id);
