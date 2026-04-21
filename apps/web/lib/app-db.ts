import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { resolveDatabaseFilePath, resolveWebRoot } from "@/lib/app-paths";
import * as schema from "@/lib/app-schema";

const MIGRATIONS_TABLE = "__critjecture_migrations";

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

let databaseInstance: AppDatabase | null = null;
let migrationPromise: Promise<void> | null = null;
let sqliteInstance: Database.Database | null = null;

async function getMigrationFileNames(migrationsDir: string) {
  const entries = await readdir(migrationsDir, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function resolveMigrationPaths() {
  const webRoot = await resolveWebRoot();

  return {
    dbFilePath: await resolveDatabaseFilePath(),
    migrationsDir: path.join(webRoot, "drizzle-v2"),
  };
}

async function runMigrations(sqlite: Database.Database) {
  const { migrationsDir } = await resolveMigrationPaths();
  const migrationFiles = await getMigrationFileNames(migrationsDir);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedRows = sqlite
    .prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`)
    .all() as Array<{ id: string }>;
  const appliedIds = new Set(appliedRows.map((row) => row.id));

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
}

async function createDatabase() {
  const { dbFilePath } = await resolveMigrationPaths();
  await mkdir(path.dirname(dbFilePath), { recursive: true });

  const sqlite = new Database(dbFilePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqliteInstance = sqlite;

  databaseInstance = drizzle(sqlite, { schema });

  if (!migrationPromise) {
    migrationPromise = runMigrations(sqlite);
  }

  await migrationPromise;

  return databaseInstance;
}

export async function ensureDatabaseReady() {
  if (databaseInstance) {
    if (migrationPromise) {
      await migrationPromise;
    }

    return databaseInstance;
  }

  return createDatabase();
}

export const getAppDatabase = ensureDatabaseReady;

export async function getAppDatabaseRuntimeMetadata() {
  await ensureDatabaseReady();
  const { dbFilePath } = await resolveMigrationPaths();
  const journalMode = String(
    sqliteInstance?.pragma("journal_mode", { simple: true }) ?? "unknown",
  ).toLowerCase();

  return {
    databasePath: dbFilePath,
    journalMode,
  };
}

export async function resetAppDatabaseForTests() {
  migrationPromise = null;
  databaseInstance = null;

  if (!sqliteInstance) {
    return;
  }

  sqliteInstance.close();
  sqliteInstance = null;
}
