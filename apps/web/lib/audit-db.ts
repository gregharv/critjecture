import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import * as schema from "@/lib/audit-schema";

const MIGRATIONS_TABLE = "__critjecture_migrations";

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

let databaseInstance: AppDatabase | null = null;
let migrationPromise: Promise<void> | null = null;

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveWebRoot() {
  const candidates = [
    path.resolve(process.cwd(), "apps/web"),
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), ".."),
  ];

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "package.json"))) {
      const packageJsonPath = path.join(candidate, "package.json");
      const packageJson = await readFile(packageJsonPath, "utf8").catch(() => "");

      if (packageJson.includes('"name": "web"')) {
        return candidate;
      }
    }
  }

  throw new Error("Unable to locate apps/web for audit database setup.");
}

async function resolveAuditPaths() {
  const webRoot = await resolveWebRoot();

  return {
    dbFilePath: path.join(webRoot, "data", "audit.sqlite"),
    migrationsDir: path.join(webRoot, "drizzle"),
  };
}

async function ensureDatabaseDirectory(dbFilePath: string) {
  await mkdir(path.dirname(dbFilePath), { recursive: true });
}

async function getMigrationFileNames(migrationsDir: string) {
  if (!(await pathExists(migrationsDir))) {
    return [];
  }

  const entries = await readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function runMigrations(sqlite: Database.Database) {
  const { migrationsDir } = await resolveAuditPaths();
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
        .prepare(
          `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`,
        )
        .run(migrationFile, Date.now());
    });

    applyMigration();
  }
}

async function createDatabase() {
  const { dbFilePath } = await resolveAuditPaths();
  await ensureDatabaseDirectory(dbFilePath);

  const sqlite = new Database(dbFilePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  databaseInstance = drizzle(sqlite, { schema });

  if (!migrationPromise) {
    migrationPromise = runMigrations(sqlite);
  }

  await migrationPromise;

  return databaseInstance;
}

export async function getAppDatabase() {
  if (databaseInstance) {
    if (migrationPromise) {
      await migrationPromise;
    }

    return databaseInstance;
  }

  return createDatabase();
}

export const getAuditDatabase = getAppDatabase;
