import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..", "..");

function parseConfiguredFilePath(value, baseDir) {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("file:")) {
    return fileURLToPath(new URL(trimmed));
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error("Only SQLite file-backed URLs are supported for V1->V2 import.");
  }

  return path.resolve(baseDir, trimmed);
}

async function resolveStorageRoot() {
  const configuredPath = parseConfiguredFilePath(process.env.CRITJECTURE_STORAGE_ROOT ?? "", repoRoot);
  if (configuredPath) {
    return configuredPath;
  }
  return path.join(repoRoot, "storage");
}

async function resolveLegacyDatabaseFilePath() {
  const configuredPath = parseConfiguredFilePath(
    process.env.CRITJECTURE_LEGACY_DATABASE_URL ?? process.env.LEGACY_DATABASE_URL ?? "",
    repoRoot,
  );
  if (configuredPath) {
    return configuredPath;
  }
  return path.join(await resolveStorageRoot(), "critjecture.sqlite");
}

async function resolveV2DatabaseFilePath() {
  const configuredPath = parseConfiguredFilePath(
    process.env.DATABASE_URL ?? process.env.CRITJECTURE_V2_DATABASE_URL ?? "",
    repoRoot,
  );
  if (configuredPath) {
    return configuredPath;
  }
  return path.join(await resolveStorageRoot(), "critjecture-v2.sqlite");
}

function tableExists(sqlite, tableName) {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function normalizeDatasetKind(value) {
  if (value === "table" || value === "spreadsheet") {
    return value;
  }
  return null;
}

function normalizeDatasetStatus(value) {
  if (value === "active" || value === "archived" || value === "deprecated") {
    return value;
  }
  return "active";
}

function normalizeConnectionKind(value) {
  if (["filesystem", "upload", "bulk_import", "google_drive", "google_sheets", "s3", "database"].includes(value)) {
    return value;
  }
  return "filesystem";
}

function normalizeConnectionStatus(value) {
  if (["active", "paused", "error", "archived"].includes(value)) {
    return value;
  }
  return "active";
}

function normalizeIngestionStatus(value) {
  if (["pending", "profiling", "ready", "failed", "archived"].includes(value)) {
    return value;
  }
  if (value === "ready") {
    return "ready";
  }
  return "pending";
}

function parseJsonObject(value, fallback = {}) {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function discoverColumns(metadataJson) {
  const metadata = parseJsonObject(metadataJson, {});
  const candidates = [
    metadata.columns,
    metadata.schema?.columns,
    metadata.csvSchema?.columns,
    metadata.profile?.columns,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((column, index) => {
          if (!column || typeof column !== "object") {
            return null;
          }

          const columnName = String(
            column.name ?? column.columnName ?? column.field ?? column.key ?? "",
          ).trim();

          if (!columnName) {
            return null;
          }

          const physicalType = String(
            column.physicalType ?? column.type ?? column.dataType ?? "unknown",
          ).trim() || "unknown";

          return {
            columnName,
            columnOrder: Number.isFinite(column.columnOrder) ? Number(column.columnOrder) : index,
            description: typeof column.description === "string" ? column.description : null,
            displayName: typeof column.displayName === "string" ? column.displayName : columnName,
            nullable: Boolean(column.nullable ?? true),
            physicalType,
          };
        })
        .filter(Boolean);
    }
  }

  return [];
}

async function run() {
  const sourceDbPath = await resolveLegacyDatabaseFilePath();
  const targetDbPath = await resolveV2DatabaseFilePath();

  await mkdir(path.dirname(targetDbPath), { recursive: true });

  const source = new Database(sourceDbPath, { readonly: true });
  const target = new Database(targetDbPath);
  target.pragma("foreign_keys = ON");

  if (!tableExists(target, "users") || !tableExists(target, "datasets")) {
    throw new Error(
      `Target V2 database ${targetDbPath} is not migrated. Run pnpm --filter web db:migrate first.`,
    );
  }

  const counts = {
    users: 0,
    organizations: 0,
    memberships: 0,
    workspacePlans: 0,
    dataConnections: 0,
    datasets: 0,
    datasetVersions: 0,
    datasetVersionColumns: 0,
  };

  const importTransaction = target.transaction(() => {
    if (tableExists(source, "users")) {
      const insertUser = target.prepare(`
        INSERT OR IGNORE INTO users (id, email, name, status, password_hash, created_at, updated_at)
        VALUES (@id, @email, @name, @status, @passwordHash, @createdAt, @updatedAt)
      `);
      for (const row of source.prepare("SELECT * FROM users").all()) {
        insertUser.run({
          id: row.id,
          email: row.email,
          name: row.name ?? null,
          status: row.status ?? "active",
          passwordHash: row.password_hash,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        counts.users += 1;
      }
    }

    if (tableExists(source, "organizations")) {
      const insertOrg = target.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
        VALUES (@id, @name, @slug, @status, @createdAt, @updatedAt)
      `);
      for (const row of source.prepare("SELECT * FROM organizations").all()) {
        insertOrg.run({
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status ?? "active",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        counts.organizations += 1;
      }
    }

    if (tableExists(source, "organization_memberships")) {
      const insertMembership = target.prepare(`
        INSERT OR IGNORE INTO organization_memberships (
          id, organization_id, user_id, role, status, monthly_credit_cap, created_at, updated_at
        ) VALUES (
          @id, @organizationId, @userId, @role, @status, @monthlyCreditCap, @createdAt, @updatedAt
        )
      `);
      for (const row of source.prepare("SELECT * FROM organization_memberships").all()) {
        insertMembership.run({
          id: row.id,
          organizationId: row.organization_id,
          userId: row.user_id,
          role: row.role,
          status: row.status,
          monthlyCreditCap: row.monthly_credit_cap ?? null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        counts.memberships += 1;
      }
    }

    if (tableExists(source, "workspace_plans")) {
      const insertPlan = target.prepare(`
        INSERT OR IGNORE INTO workspace_plans (
          id, organization_id, plan_code, plan_name, monthly_included_credits,
          billing_anchor_at, current_window_start_at, current_window_end_at,
          hard_cap_behavior, rate_card_json, created_at, updated_at
        ) VALUES (
          @id, @organizationId, @planCode, @planName, @monthlyIncludedCredits,
          @billingAnchorAt, @currentWindowStartAt, @currentWindowEndAt,
          @hardCapBehavior, @rateCardJson, @createdAt, @updatedAt
        )
      `);
      for (const row of source.prepare("SELECT * FROM workspace_plans").all()) {
        insertPlan.run({
          id: row.id,
          organizationId: row.organization_id,
          planCode: row.plan_code,
          planName: row.plan_name,
          monthlyIncludedCredits: row.monthly_included_credits,
          billingAnchorAt: row.billing_anchor_at,
          currentWindowStartAt: row.current_window_start_at,
          currentWindowEndAt: row.current_window_end_at,
          hardCapBehavior: row.hard_cap_behavior ?? "block",
          rateCardJson: row.rate_card_json ?? "{}",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        counts.workspacePlans += 1;
      }
    }

    if (tableExists(source, "data_connections")) {
      const insertConnection = target.prepare(`
        INSERT OR IGNORE INTO data_connections (
          id, organization_id, kind, display_name, status, config_json,
          credentials_ref, last_sync_at, created_at, updated_at
        ) VALUES (
          @id, @organizationId, @kind, @displayName, @status, @configJson,
          @credentialsRef, @lastSyncAt, @createdAt, @updatedAt
        )
      `);
      for (const row of source.prepare("SELECT * FROM data_connections").all()) {
        insertConnection.run({
          id: row.id,
          organizationId: row.organization_id,
          kind: normalizeConnectionKind(row.kind),
          displayName: row.display_name,
          status: normalizeConnectionStatus(row.status),
          configJson: row.config_json ?? "{}",
          credentialsRef: row.credentials_ref ?? null,
          lastSyncAt: row.last_sync_at ?? null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        counts.dataConnections += 1;
      }
    }

    const importedDatasetIds = new Set();

    if (tableExists(source, "data_assets")) {
      const insertDataset = target.prepare(`
        INSERT OR IGNORE INTO datasets (
          id, organization_id, connection_id, dataset_key, display_name, description,
          access_scope, data_kind, grain_description, time_column_name, entity_id_column_name,
          status, active_version_id, metadata_json, created_by_user_id, created_at, updated_at
        ) VALUES (
          @id, @organizationId, @connectionId, @datasetKey, @displayName, @description,
          @accessScope, @dataKind, @grainDescription, @timeColumnName, @entityIdColumnName,
          @status, @activeVersionId, @metadataJson, @createdByUserId, @createdAt, @updatedAt
        )
      `);
      for (const row of source.prepare("SELECT * FROM data_assets ORDER BY created_at ASC").all()) {
        const dataKind = normalizeDatasetKind(row.data_kind);
        if (!dataKind) {
          continue;
        }

        insertDataset.run({
          id: row.id,
          organizationId: row.organization_id,
          connectionId: row.connection_id ?? null,
          datasetKey: row.asset_key,
          displayName: row.display_name,
          description: null,
          accessScope: row.access_scope ?? "admin",
          dataKind,
          grainDescription: null,
          timeColumnName: null,
          entityIdColumnName: null,
          status: normalizeDatasetStatus(row.status),
          activeVersionId: row.active_version_id ?? null,
          metadataJson: row.metadata_json ?? "{}",
          createdByUserId: null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        importedDatasetIds.add(row.id);
        counts.datasets += 1;
      }
    }

    if (tableExists(source, "data_asset_versions")) {
      const insertVersion = target.prepare(`
        INSERT OR IGNORE INTO dataset_versions (
          id, dataset_id, organization_id, version_number, source_version_token,
          source_modified_at, content_hash, schema_hash, row_count, byte_size,
          materialized_path, ingestion_status, profile_status, ingestion_error,
          profile_error, indexed_at, metadata_json, created_at, updated_at
        ) VALUES (
          @id, @datasetId, @organizationId, @versionNumber, @sourceVersionToken,
          @sourceModifiedAt, @contentHash, @schemaHash, @rowCount, @byteSize,
          @materializedPath, @ingestionStatus, @profileStatus, @ingestionError,
          @profileError, @indexedAt, @metadataJson, @createdAt, @updatedAt
        )
      `);
      const insertColumn = target.prepare(`
        INSERT OR IGNORE INTO dataset_version_columns (
          id, dataset_version_id, organization_id, column_name, display_name,
          column_order, physical_type, semantic_type, nullable,
          is_indexed_candidate, is_treatment_candidate, is_outcome_candidate,
          description, metadata_json, created_at
        ) VALUES (
          @id, @datasetVersionId, @organizationId, @columnName, @displayName,
          @columnOrder, @physicalType, 'unknown', @nullable,
          0, 0, 0,
          @description, '{}', @createdAt
        )
      `);

      const rows = source
        .prepare("SELECT * FROM data_asset_versions ORDER BY asset_id ASC, created_at ASC")
        .all();

      let currentAssetId = null;
      let versionNumber = 0;

      for (const row of rows) {
        if (!importedDatasetIds.has(row.asset_id)) {
          continue;
        }

        if (row.asset_id !== currentAssetId) {
          currentAssetId = row.asset_id;
          versionNumber = 0;
        }
        versionNumber += 1;

        insertVersion.run({
          id: row.id,
          datasetId: row.asset_id,
          organizationId: row.organization_id,
          versionNumber,
          sourceVersionToken: row.source_version_token ?? null,
          sourceModifiedAt: row.source_modified_at ?? null,
          contentHash: row.content_hash,
          schemaHash: row.schema_hash ?? row.content_hash,
          rowCount: row.row_count ?? null,
          byteSize: row.byte_size ?? null,
          materializedPath: row.materialized_path,
          ingestionStatus: normalizeIngestionStatus(row.ingestion_status),
          profileStatus: "pending",
          ingestionError: row.ingestion_error ?? null,
          profileError: null,
          indexedAt: row.indexed_at ?? null,
          metadataJson: row.metadata_json ?? "{}",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        counts.datasetVersions += 1;

        for (const column of discoverColumns(row.metadata_json)) {
          insertColumn.run({
            id: `${row.id}:column:${column.columnOrder}`,
            datasetVersionId: row.id,
            organizationId: row.organization_id,
            columnName: column.columnName,
            displayName: column.displayName,
            columnOrder: column.columnOrder,
            physicalType: column.physicalType,
            nullable: column.nullable ? 1 : 0,
            description: column.description,
            createdAt: row.created_at,
          });
          counts.datasetVersionColumns += 1;
        }
      }
    }
  });

  importTransaction();

  source.close();
  target.close();

  console.log(JSON.stringify({ sourceDbPath, targetDbPath, counts }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
