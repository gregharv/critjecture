import Database from "better-sqlite3";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..", "..");

const LEGACY_TABLES = [
  "conversations",
  "conversation_pins",
  "chat_turns",
  "tool_calls",
  "assistant_messages",
  "analysis_results",
  "workflows",
  "workflow_versions",
  "workflow_runs",
  "workflow_run_steps",
  "workflow_run_input_checks",
  "workflow_run_resolved_inputs",
  "workflow_input_requests",
  "workflow_deliveries",
  "retrieval_runs",
  "retrieval_rewrites",
  "retrieval_candidates",
  "response_citations",
];

function parseConfiguredFilePath(value, baseDir) {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("file:")) {
    return fileURLToPath(new URL(trimmed));
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error("Only SQLite file-backed URLs are supported for legacy archival.");
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

function existingTables(sqlite) {
  return new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
}

async function run() {
  const sourceDbPath = await resolveLegacyDatabaseFilePath();
  const storageRoot = await resolveStorageRoot();
  const archiveDir = path.join(storageRoot, "legacy-archives", new Date().toISOString().replace(/[:.]/g, "-"));
  const archiveDbPath = path.join(archiveDir, "critjecture-v1-archive.sqlite");
  const manifestPath = path.join(archiveDir, "manifest.json");

  const sqlite = new Database(sourceDbPath, { readonly: true });
  const tables = existingTables(sqlite);
  const presentLegacyTables = LEGACY_TABLES.filter((table) => tables.has(table));
  sqlite.close();

  await mkdir(archiveDir, { recursive: true });
  await copyFile(sourceDbPath, archiveDbPath);
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        archivedAt: Date.now(),
        archiveDbPath,
        legacySourceDbPath: sourceDbPath,
        presentLegacyTables,
        requiredLegacyTables: LEGACY_TABLES,
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify({ archiveDbPath, manifestPath, presentLegacyTablesCount: presentLegacyTables.length }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
