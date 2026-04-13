# Workflow Asset Architecture Build Checklist

This document is a step-by-step implementation checklist for making chat and workflows use the same versioned data input system.

## Goal

Unify data access across:
- local `company_data` files
- uploaded knowledge files
- bulk imports
- future connectors like Google Drive

And enable workflows to:
- resolve stable data assets instead of loose file paths
- detect when data changed
- detect when data is stale
- skip or rerun based on update policies
- execute against a frozen snapshot per run

---

## Problem Summary

Today there is a mismatch:
- chat search can use raw files in `company_data`
- workflows resolve only from managed `documents`

This causes runs to fail with `waiting_for_input` even when files exist on disk.

## Target Direction

Move from:
- file-path-based workflow inputs
- split chat/workflow resolution
- unversioned current files

To:
- versioned data assets
- one registry for chat and workflows
- connector-aware ingestion and sync
- run-time snapshot resolution

---

## Implementation status note (2026-04-13)

Implemented in code:
- Phases 0 through 7 are functionally implemented
- Phase 8 has an **OAuth-ready scaffold** implemented, not full live Google OAuth yet
- current system now supports:
  - local filesystem assets
  - uploaded knowledge assets
  - bulk import assets
  - snapshot-first workflow execution against asset versions
  - skip/block validation policies for unchanged or stale inputs
  - chat search backed by managed asset versions
  - mocked Google Drive sync into documents + assets + asset versions

Still left to change after the current stop point:
- finish Phase 8 with a real Google Drive OAuth client
  - token exchange / refresh flow
  - secure credential storage behind `credentialsRef`
  - real Drive API `discover` / `listSelectedFiles` / `downloadFile`
  - user-facing selection / preview flow for Drive files
- finish remaining operational pieces from earlier phases
  - filesystem/admin-triggered reconcile command or startup scan
  - optional connector admin action / scheduled sync entry points
- Phase 9
  - asset update triggers that auto-queue workflows when new ready asset versions appear
- Phase 10
  - broader end-to-end test coverage, especially disconnected connector failure handling
- Phase 11
  - backfills for existing local files and legacy documents
  - migration/compatibility logging cleanup
  - connector health visibility / operations checks

Use this note as the current checkpoint while testing workflow behavior.

---

# Phase 0 — Fix the current mismatch

**Goal:** Files in `company_data` work for both chat and workflows.

## Schema
- [ ] Add a new table: `data_assets`
- [ ] Add a new table: `data_asset_versions`
- [ ] Add a new table: `workflow_run_resolved_inputs`
- [ ] Create a Drizzle migration, e.g. `apps/web/drizzle/0014_data_assets.sql`

## Services
- [ ] Add `apps/web/lib/data-assets.ts`
  - [ ] `findAssetByPath()`
  - [ ] `createOrUpdateFilesystemAsset()`
  - [ ] `createAssetVersionIfChanged()`
  - [ ] `getLatestReadyAssetVersion()`
- [ ] Add `apps/web/lib/data-asset-resolution.ts`
  - [ ] resolve asset bindings
  - [ ] resolve latest ready version
  - [ ] freeze run snapshot

## Workflow builder
- [ ] Update `apps/web/lib/workflow-builder.ts`
  - [ ] when an input path like `admin/foo.csv` is found, ensure it is registered as an asset
  - [ ] stop relying on fallback `display_name_equals` selectors for local files
  - [ ] bind to stable asset references instead

## Workflow engine
- [ ] Update `apps/web/lib/workflow-engine.ts`
  - [ ] resolve workflow inputs from assets/versions, not just `documents`
  - [ ] persist `workflow_run_resolved_inputs`
  - [ ] pass resolved materialized paths into step execution

## Search compatibility
- [ ] Update `apps/web/lib/company-knowledge.ts`
  - [ ] when search finds a raw filesystem file, ensure a matching asset exists
  - [ ] return/search result paths that map to a managed asset

## Acceptance
- [ ] `admin/contractors.csv` can be found in chat
- [ ] the same file can be used in a workflow run
- [ ] run no longer goes `waiting_for_input` for known local files

---

# Phase 1 — Introduce the asset/version model cleanly

**Goal:** Make the new model explicit and durable.

## Schema design
- [ ] `data_connections`
- [ ] `data_assets`
- [ ] `data_asset_versions`
- [ ] `workflow_run_resolved_inputs`

## Suggested fields

### `data_connections`
- [ ] `id`
- [ ] `organization_id`
- [ ] `kind`
- [ ] `display_name`
- [ ] `status`
- [ ] `config_json`
- [ ] `credentials_ref`
- [ ] `last_sync_at`
- [ ] `created_at`
- [ ] `updated_at`

### `data_assets`
- [ ] `id`
- [ ] `organization_id`
- [ ] `connection_id`
- [ ] `asset_key`
- [ ] `display_name`
- [ ] `access_scope`
- [ ] `data_kind`
- [ ] `external_object_id`
- [ ] `active_version_id`
- [ ] `status`
- [ ] `metadata_json`
- [ ] `created_at`
- [ ] `updated_at`

### `data_asset_versions`
- [ ] `id`
- [ ] `asset_id`
- [ ] `organization_id`
- [ ] `source_version_token`
- [ ] `source_modified_at`
- [ ] `content_hash`
- [ ] `schema_hash`
- [ ] `mime_type`
- [ ] `byte_size`
- [ ] `row_count`
- [ ] `materialized_path`
- [ ] `ingestion_status`
- [ ] `ingestion_error`
- [ ] `indexed_at`
- [ ] `metadata_json`
- [ ] `created_at`
- [ ] `updated_at`

### `workflow_run_resolved_inputs`
- [ ] `id`
- [ ] `run_id`
- [ ] `organization_id`
- [ ] `input_key`
- [ ] `asset_id`
- [ ] `asset_version_id`
- [ ] `content_hash`
- [ ] `schema_hash`
- [ ] `materialized_path`
- [ ] `display_name`
- [ ] `resolved_at`
- [ ] `metadata_json`

## Indexes
- [ ] `data_assets(organization_id, asset_key)`
- [ ] `data_assets(connection_id, external_object_id)`
- [ ] `data_asset_versions(asset_id, created_at desc)`
- [ ] `data_asset_versions(asset_id, content_hash)`
- [ ] `workflow_run_resolved_inputs(run_id, input_key)`

## Compatibility decision
- [ ] Keep `documents` for now as a compatibility/index/search layer
- [ ] Decide whether each latest ready asset version will also sync/update a `documents` row

## Suggested Drizzle schema changes

Add these tables to `apps/web/lib/app-schema.ts` after the existing knowledge/workflow tables.

### Enum choices

Recommended enum values:
- `data_connections.kind`: `filesystem`, `upload`, `bulk_import`, `google_drive`, `google_sheets`, `s3`
- `data_connections.status`: `active`, `paused`, `error`
- `data_assets.access_scope`: `public`, `admin`
- `data_assets.data_kind`: `table`, `text_document`, `pdf`, `spreadsheet`
- `data_assets.status`: `active`, `archived`
- `data_asset_versions.ingestion_status`: `pending`, `ready`, `failed`

### Suggested `app-schema.ts` additions

```ts
export const dataConnections = sqliteTable(
  "data_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["filesystem", "upload", "bulk_import", "google_drive", "google_sheets", "s3"],
    }).notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "paused", "error"] })
      .notNull()
      .default("active"),
    configJson: text("config_json").notNull().default("{}"),
    credentialsRef: text("credentials_ref"),
    lastSyncAt: integer("last_sync_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "data_connections_kind_check",
      sql`${table.kind} in ('filesystem', 'upload', 'bulk_import', 'google_drive', 'google_sheets', 's3')`,
    ),
    check(
      "data_connections_status_check",
      sql`${table.status} in ('active', 'paused', 'error')`,
    ),
    index("data_connections_org_kind_idx").on(table.organizationId, table.kind),
    index("data_connections_org_status_updated_at_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const dataAssets = sqliteTable(
  "data_assets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => dataConnections.id, {
      onDelete: "set null",
    }),
    assetKey: text("asset_key").notNull(),
    displayName: text("display_name").notNull(),
    accessScope: text("access_scope", { enum: ["public", "admin"] })
      .notNull()
      .default("admin"),
    dataKind: text("data_kind", { enum: ["table", "text_document", "pdf", "spreadsheet"] })
      .notNull()
      .default("text_document"),
    externalObjectId: text("external_object_id"),
    activeVersionId: text("active_version_id"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("data_assets_access_scope_check", sql`${table.accessScope} in ('public', 'admin')`),
    check(
      "data_assets_data_kind_check",
      sql`${table.dataKind} in ('table', 'text_document', 'pdf', 'spreadsheet')`,
    ),
    check("data_assets_status_check", sql`${table.status} in ('active', 'archived')`),
    uniqueIndex("data_assets_org_asset_key_idx").on(table.organizationId, table.assetKey),
    index("data_assets_connection_external_object_idx").on(
      table.connectionId,
      table.externalObjectId,
    ),
    index("data_assets_org_scope_updated_at_idx").on(
      table.organizationId,
      table.accessScope,
      table.updatedAt,
    ),
  ],
);

export const dataAssetVersions = sqliteTable(
  "data_asset_versions",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => dataAssets.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceVersionToken: text("source_version_token"),
    sourceModifiedAt: integer("source_modified_at"),
    contentHash: text("content_hash").notNull(),
    schemaHash: text("schema_hash"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    rowCount: integer("row_count"),
    materializedPath: text("materialized_path").notNull(),
    ingestionStatus: text("ingestion_status", { enum: ["pending", "ready", "failed"] })
      .notNull()
      .default("pending"),
    ingestionError: text("ingestion_error"),
    indexedAt: integer("indexed_at"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "data_asset_versions_ingestion_status_check",
      sql`${table.ingestionStatus} in ('pending', 'ready', 'failed')`,
    ),
    index("data_asset_versions_asset_created_at_idx").on(table.assetId, table.createdAt),
    index("data_asset_versions_asset_content_hash_idx").on(table.assetId, table.contentHash),
    index("data_asset_versions_org_ingestion_status_updated_at_idx").on(
      table.organizationId,
      table.ingestionStatus,
      table.updatedAt,
    ),
    uniqueIndex("data_asset_versions_asset_materialized_path_idx").on(
      table.assetId,
      table.materializedPath,
    ),
  ],
);

export const workflowRunResolvedInputs = sqliteTable(
  "workflow_run_resolved_inputs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inputKey: text("input_key").notNull(),
    assetId: text("asset_id")
      .notNull()
      .references(() => dataAssets.id, { onDelete: "cascade" }),
    assetVersionId: text("asset_version_id")
      .notNull()
      .references(() => dataAssetVersions.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    schemaHash: text("schema_hash"),
    materializedPath: text("materialized_path").notNull(),
    displayName: text("display_name").notNull(),
    resolvedAt: integer("resolved_at").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_run_resolved_inputs_run_id_input_key_idx").on(
      table.runId,
      table.inputKey,
    ),
    index("workflow_run_resolved_inputs_run_id_idx").on(table.runId),
    index("workflow_run_resolved_inputs_asset_version_id_idx").on(table.assetVersionId),
    index("workflow_run_resolved_inputs_org_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
```

### Schema notes

- Keep `activeVersionId` nullable initially to avoid circular foreign-key ordering problems in SQLite migrations.
- After `data_asset_versions` exists, either:
  - leave `activeVersionId` as an application-managed pointer without a DB foreign key, or
  - add a later migration to enforce it if SQLite migration complexity is acceptable.
- For local filesystem assets, store the company-data-relative path in `data_assets.metadata_json`, for example:
  - `{"relative_path":"admin/contractors.csv"}`
- For connector-backed assets, store provider-specific details in `metadata_json`, such as folder ids, Drive export hints, or source MIME type.

## Suggested Drizzle migration changes

Create a new migration such as `apps/web/drizzle/0014_data_assets.sql`.

### Migration checklist
- [ ] create `data_connections`
- [ ] create `data_assets`
- [ ] create `data_asset_versions`
- [ ] create `workflow_run_resolved_inputs`
- [ ] create indexes for resolution, sync, and lookback queries
- [ ] do **not** add aggressive backfill SQL in the first migration; use app code or a one-off script for backfill

### Suggested SQL skeleton

```sql
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

CREATE TABLE data_assets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES data_connections(id) ON DELETE SET NULL,
  asset_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  access_scope TEXT NOT NULL DEFAULT 'admin'
    CHECK (access_scope IN ('public', 'admin')),
  data_kind TEXT NOT NULL DEFAULT 'text_document'
    CHECK (data_kind IN ('table', 'text_document', 'pdf', 'spreadsheet')),
  external_object_id TEXT,
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
  source_version_token TEXT,
  source_modified_at INTEGER,
  content_hash TEXT NOT NULL,
  schema_hash TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  row_count INTEGER,
  materialized_path TEXT NOT NULL,
  ingestion_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ingestion_status IN ('pending', 'ready', 'failed')),
  ingestion_error TEXT,
  indexed_at INTEGER,
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
  schema_hash TEXT,
  materialized_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX data_connections_org_kind_idx
  ON data_connections(organization_id, kind);

CREATE INDEX data_connections_org_status_updated_at_idx
  ON data_connections(organization_id, status, updated_at);

CREATE UNIQUE INDEX data_assets_org_asset_key_idx
  ON data_assets(organization_id, asset_key);

CREATE INDEX data_assets_connection_external_object_idx
  ON data_assets(connection_id, external_object_id);

CREATE INDEX data_assets_org_scope_updated_at_idx
  ON data_assets(organization_id, access_scope, updated_at);

CREATE INDEX data_asset_versions_asset_created_at_idx
  ON data_asset_versions(asset_id, created_at);

CREATE INDEX data_asset_versions_asset_content_hash_idx
  ON data_asset_versions(asset_id, content_hash);

CREATE INDEX data_asset_versions_org_ingestion_status_updated_at_idx
  ON data_asset_versions(organization_id, ingestion_status, updated_at);

CREATE UNIQUE INDEX data_asset_versions_asset_materialized_path_idx
  ON data_asset_versions(asset_id, materialized_path);

CREATE UNIQUE INDEX workflow_run_resolved_inputs_run_id_input_key_idx
  ON workflow_run_resolved_inputs(run_id, input_key);

CREATE INDEX workflow_run_resolved_inputs_run_id_idx
  ON workflow_run_resolved_inputs(run_id);

CREATE INDEX workflow_run_resolved_inputs_asset_version_id_idx
  ON workflow_run_resolved_inputs(asset_version_id);

CREATE INDEX workflow_run_resolved_inputs_org_created_at_idx
  ON workflow_run_resolved_inputs(organization_id, created_at);
```

### Optional later migration

After the initial rollout is stable, consider a follow-up migration to add:
- a foreign key from `data_assets.active_version_id` to `data_asset_versions.id`
- an `asset_updated` workflow trigger enum value
- any subscription tables needed for event-driven runs

## Backfill and migration execution notes

- Prefer application-level backfill code over complex SQL for the first pass.
- First backfill target: local files under `storage/organizations/<slug>/company_data`.
- Second backfill target: existing managed `documents` rows from uploaded and bulk-import knowledge.
- During transition, support both:
  - old workflow bindings (`document_id`, filename selectors)
  - new workflow bindings (`asset_id`, `asset_selector`)
- Add structured logs around first-run asset creation so you can verify that workflow-builder auto-registration is working.

---

# Phase 2 — Extend workflow input binding types

**Goal:** Move from filename matching to stable asset binding.

## Workflow types
- [ ] Update `apps/web/lib/workflow-types.ts`
  - [ ] add binding kind: `asset_id`
  - [ ] add binding kind: `asset_selector`
  - [ ] optional: `lock_to_asset_version_id`
  - [ ] optional: `lock_to_content_hash`

## Parser/validator
- [ ] Update workflow JSON parsing in `apps/web/lib/workflow-types.ts`
- [ ] validate new binding payloads
- [ ] preserve backward compatibility for old `document_id` and `selector`

## Builder output
- [ ] Update `apps/web/lib/workflow-builder.ts`
  - [ ] produce `asset_id` bindings where possible
  - [ ] use `asset_selector` only when stable asset id is not available
  - [ ] avoid display-name-only binding for recurring workflows

## Acceptance
- [ ] newly created workflows bind to assets, not filenames
- [ ] old workflows still run

---

# Phase 3 — Freeze run snapshots

**Goal:** Every run executes against a fixed version set.

## Workflow engine
- [ ] Update `resolveWorkflowInputBindings()` in `apps/web/lib/workflow-engine.ts`
  - [ ] resolve binding → asset
  - [ ] resolve asset → latest ready version
  - [ ] persist row into `workflow_run_resolved_inputs`

## Step execution
- [ ] update input file resolution to use `workflow_run_resolved_inputs`
- [ ] ensure Python/chart steps use the materialized snapshot paths
- [ ] ensure retries use the same snapshot unless explicitly refreshed

## Run metadata
- [ ] add snapshot summary into `workflow_runs.metadata_json`
  - [ ] asset ids
  - [ ] version ids
  - [ ] hashes
  - [ ] timestamps

## Acceptance
- [ ] if source data changes mid-run, execution stays consistent
- [ ] resolved input versions are auditable after the run

---

# Phase 4 — Add change detection and freshness policies

**Goal:** Workflows only run when they should.

## Workflow input policy
- [ ] Extend `WorkflowInputSpecV1` in `apps/web/lib/workflow-types.ts`
  - [ ] keep `freshness`
  - [ ] extend or replace `duplicate_policy`
  - [ ] add `skip_if_unchanged`
  - [ ] add `must_be_newer_than_last_successful_run`

## Validator
- [ ] Update `apps/web/lib/workflow-validator.ts`
  - [ ] compare current resolved version to last successful run
  - [ ] compare content hash
  - [ ] compare source version token if present
  - [ ] support outcomes:
    - [ ] pass
    - [ ] warn
    - [ ] fail
    - [ ] skip

## Engine behavior
- [ ] Update `apps/web/lib/workflow-engine.ts`
  - [ ] if validation says skip, mark run accordingly
  - [ ] optionally add a `skipped` terminal state later, or represent in metadata first

## Acceptance
- [ ] unchanged input can skip execution
- [ ] stale input can block validation
- [ ] changed input runs normally

---

# Phase 5 — Build the filesystem connector

**Goal:** Unify `company_data` with the future connector architecture.

## Connection layer
- [ ] Add `apps/web/lib/data-connections.ts`
- [ ] Add `apps/web/lib/connectors/filesystem-connector.ts`

## Filesystem connector features
- [ ] scan `storage/organizations/<slug>/company_data`
- [ ] infer asset key from relative path
- [ ] assign `access_scope` from `public/` vs `admin/`
- [ ] compute:
  - [ ] content hash
  - [ ] schema hash for CSVs
  - [ ] row count for CSVs
  - [ ] modified time
- [ ] create new asset version only if changed
- [ ] set latest ready version
- [ ] optionally sync latest version into `documents`

## Jobs
- [ ] create a sync or reconcile command or worker job
- [ ] support full scan on startup or admin action

## Acceptance
- [ ] editing a local file creates a new asset version
- [ ] workflow sees the new version on next run
- [ ] unchanged file does not create duplicate versions

---

# Phase 6 — Make search use managed asset versions

**Goal:** Chat and workflows use one input registry.

## Search layer
- [ ] Update `apps/web/lib/company-knowledge.ts`
  - [ ] build manifest from latest ready asset versions, not raw files only
  - [ ] preserve file preview behavior
  - [ ] keep scope filtering

## Search result payloads
- [ ] include asset metadata in candidate files
  - [ ] asset id
  - [ ] version id
  - [ ] display name
  - [ ] materialized/source path

## Acceptance
- [ ] chat search returns results backed by managed assets
- [ ] selected files from chat map directly into workflow bindings

---

# Phase 7 — Add upload/import integration to assets

**Goal:** Unify existing knowledge uploads/imports with the new asset model.

## Knowledge ingestion
- [ ] Update `apps/web/lib/knowledge-files.ts`
- [ ] Update `apps/web/lib/knowledge-imports.ts`
  - [ ] uploaded file creates or updates an asset
  - [ ] import job output creates asset versions
  - [ ] keep `documents` in sync during transition

## Acceptance
- [ ] uploaded CSVs and local files appear in the same asset registry
- [ ] workflows can bind to either with the same mechanism

---

# Phase 8 — Add Google Drive connector

**Goal:** Support connected external sources.

**Current checkpoint:** an OAuth-ready scaffold is implemented. The codebase now has `apps/web/lib/connectors/google-drive-connector.ts`, `google_drive` data connections, mocked sync/materialization, asset versioning, and workflow binding by `external_object_id`. Real live Google OAuth and Drive API integration are still pending.

## Connector implementation
- [ ] Add `apps/web/lib/connectors/google-drive-connector.ts`
- [ ] support auth/config in `data_connections`
- [ ] support metadata sync:
  - [ ] file id
  - [ ] revision/token
  - [ ] modified time
  - [ ] checksum if available
  - [ ] mime type
- [ ] support content materialization into managed storage
- [ ] create asset versions from fetched content

## Change detection
- [ ] use source revision token first
- [ ] use checksum second
- [ ] use modified time as fallback
- [ ] fetch-and-hash when needed

## Sync behavior
- [ ] build poll-based sync first
- [ ] add webhook/change notifications later

## Acceptance
- [ ] a Drive file becomes a managed asset
- [ ] new Drive revisions create new asset versions
- [ ] workflows can bind by stable external object id

---

# Phase 9 — Add workflow triggers on asset updates

**Goal:** Auto-run workflows when data changes.

## Trigger model
- [ ] extend workflow trigger definitions
- [ ] add `asset_updated` or equivalent trigger kind
- [ ] allow workflow subscription to:
  - [ ] asset id
  - [ ] asset key
  - [ ] selector

## Worker behavior
- [ ] when a new ready asset version is created:
  - [ ] find subscribed workflows
  - [ ] evaluate change policy
  - [ ] queue runs

## Acceptance
- [ ] “Drive file updated” automatically queues chart workflow
- [ ] “local file updated” can do the same

---

# Phase 10 — Testing checklist

**Goal:** Verify the architecture works end-to-end.

## Unit tests
- [ ] asset resolution by asset id
- [ ] asset resolution by selector
- [ ] new version created only on change
- [ ] unchanged detection works
- [ ] freshness validation works
- [ ] CSV schema hash logic works

## Integration tests
- [ ] local `company_data` file usable in chat and workflow
- [ ] workflow snapshot is frozen
- [ ] workflow skips when input unchanged
- [ ] workflow runs when file updated
- [ ] uploaded file and filesystem file both resolve correctly

## Future connector tests
- [ ] Google Drive metadata change produces new version
- [ ] same revision does not produce duplicate version
- [ ] disconnected source results in safe failure

---

# Phase 11 — Rollout checklist

**Goal:** Migrate safely without breaking existing runs.

## Backfill
- [ ] backfill local `company_data` files into assets
- [ ] backfill existing managed `documents` into assets
- [ ] populate active latest versions

## Compatibility
- [ ] preserve old workflow bindings during transition
- [ ] support both old and new binding resolution paths temporarily
- [ ] log when old filename selector fallback is used

## Observability
- [ ] add structured logs for:
  - [ ] asset created
  - [ ] asset version created
  - [ ] workflow input resolved
  - [ ] workflow skipped due to unchanged input
  - [ ] connector sync result

## Admin visibility
- [ ] add operations health check for connector syncs
- [ ] add asset/version inspection UI later if needed

---

# Recommended implementation order

## Sprint 1
- [ ] Phase 0
- [ ] Phase 1 schema
- [ ] basic filesystem asset registration

## Sprint 2
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4 change detection / skip-if-unchanged

## Sprint 3
- [ ] Phase 5 filesystem connector
- [ ] Phase 6 search unification
- [ ] Phase 7 upload/import asset integration

## Sprint 4
- [ ] Phase 8 Google Drive connector
- [ ] Phase 9 auto-trigger workflows

---

# Best first coding slice

If implementing the highest-value first patch set, do this:

- [ ] add `data_assets`
- [ ] add `data_asset_versions`
- [ ] add `workflow_run_resolved_inputs`
- [ ] register `company_data` files as assets
- [ ] update `workflow-builder.ts` to bind to assets
- [ ] update `workflow-engine.ts` to resolve latest ready asset versions
- [ ] add `skip_if_unchanged` using content hash comparison

This gets:
- the current bug fixed
- local file support
- versioned workflow inputs
- a clean base for Google Drive and other connectors

---

# Key design principles

- Use stable asset identity, not display names, whenever possible.
- Freeze resolved versions at run start.
- Materialize connector data into managed storage before workflow execution.
- Detect changes using source metadata first and content hashes second.
- Keep search and workflow resolution backed by the same asset registry.
- Preserve backward compatibility during migration, then phase out filename-only bindings.
