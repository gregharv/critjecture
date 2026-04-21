import Database from "better-sqlite3";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_TABLE = "__critjecture_migrations";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..", "..");

function parseConfiguredFilePath(value, baseDir) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("file:")) {
    return fileURLToPath(new URL(trimmed));
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error(
      "Step 10 supports SQLite file-backed DATABASE_URL values only. Use a filesystem path or file: URL.",
    );
  }

  return path.resolve(baseDir, trimmed);
}

async function resolveStorageRoot() {
  const configuredPath = parseConfiguredFilePath(
    process.env.CRITJECTURE_STORAGE_ROOT ?? "",
    repoRoot,
  );

  if (configuredPath) {
    return configuredPath;
  }

  return path.join(repoRoot, "storage");
}

async function resolveDatabaseFilePath() {
  const configuredPath = parseConfiguredFilePath(
    process.env.DATABASE_URL ?? process.env.CRITJECTURE_V2_DATABASE_URL ?? "",
    repoRoot,
  );

  if (configuredPath) {
    return configuredPath;
  }

  return path.join(await resolveStorageRoot(), "critjecture-v2.sqlite");
}

async function getMigrationFileNames(migrationsDir) {
  const entries = await readdir(migrationsDir, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function run() {
  const dbFilePath = await resolveDatabaseFilePath();
  const migrationsDir = path.join(webRoot, "drizzle-v2");

  await mkdir(path.dirname(dbFilePath), { recursive: true });

  const sqlite = new Database(dbFilePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedRows = sqlite
    .prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`)
    .all();
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const migrationFiles = await getMigrationFileNames(migrationsDir);

  for (const migrationFile of migrationFiles) {
    if (appliedIds.has(migrationFile)) {
      continue;
    }

    const migrationSql = await readFile(path.join(migrationsDir, migrationFile), "utf8");
    const applyMigration = sqlite.transaction(() => {
      sqlite.exec(migrationSql);
      sqlite
        .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`)
        .run(migrationFile, Date.now());
    });

    applyMigration();
  }

  sqlite.close();
  console.log(`Applied migrations to ${dbFilePath}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
