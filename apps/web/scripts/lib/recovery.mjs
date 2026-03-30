import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BACKUP_FORMAT_VERSION = 1;
const DATABASE_ARTIFACT_NAME = "database.sqlite";
const MANIFEST_FILE_NAME = "manifest.json";
const MIGRATIONS_TABLE = "__critjecture_migrations";
const STORAGE_ARTIFACT_NAME = "storage.tar.gz";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..", "..");
const repositoryRoot = path.resolve(webRoot, "..", "..");

function normalizeDeploymentMode(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "hosted") {
    return "hosted";
  }

  return "single_org";
}

function parseConfiguredFilePath(value, baseDir) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("file:")) {
    return fileURLToPath(new URL(trimmed));
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error(
      "Critjecture backup tooling supports SQLite file-backed DATABASE_URL values only.",
    );
  }

  return path.resolve(baseDir, trimmed);
}

function formatBackupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function toPosixRelative(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function isPathInside(parentPath, childPath) {
  const normalizedParent = path.resolve(parentPath);
  const normalizedChild = path.resolve(childPath);
  const relative = path.relative(normalizedParent, normalizedChild);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectoryEmpty(directoryPath, label) {
  if (!(await pathExists(directoryPath))) {
    return;
  }

  const stats = await stat(directoryPath);

  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory path.`);
  }

  const entries = await readdir(directoryPath);

  if (entries.length > 0) {
    throw new Error(`${label} must be empty before restore.`);
  }
}

async function ensureFileMissing(filePath, label) {
  if (await pathExists(filePath)) {
    throw new Error(`${label} already exists and restore only supports clean targets.`);
  }
}

async function computeFileSha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function listOrganizationSlugs(storageRoot) {
  const organizationsRoot = path.join(storageRoot, "organizations");
  const entries = await readdir(organizationsRoot, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function getDefaultMigrationsDir() {
  return path.join(webRoot, "drizzle");
}

export function parseArgs(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (!entry.startsWith("--")) {
      continue;
    }

    const key = entry.slice(2);
    const nextValue = argv[index + 1];
    values[key] = nextValue && !nextValue.startsWith("--") ? nextValue : "true";

    if (values[key] === nextValue) {
      index += 1;
    }
  }

  return values;
}

export function getDefaultRuntimePaths(env = process.env) {
  const storageRoot =
    parseConfiguredFilePath(env.CRITJECTURE_STORAGE_ROOT, repositoryRoot) ??
    path.join(repositoryRoot, "storage");
  const databasePath =
    parseConfiguredFilePath(env.DATABASE_URL, repositoryRoot) ??
    path.join(storageRoot, "critjecture.sqlite");

  return {
    databasePath,
    deploymentMode: normalizeDeploymentMode(env.CRITJECTURE_DEPLOYMENT_MODE),
    migrationsDir: getDefaultMigrationsDir(),
    repositoryRoot,
    storageRoot,
    webRoot,
  };
}

export async function runMigrationsOnDatabasePath(
  databasePath,
  { migrationsDir = getDefaultMigrationsDir() } = {},
) {
  await mkdir(path.dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    const appliedRows = sqlite
      .prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`)
      .all();
    const appliedIds = new Set(appliedRows.map((row) => String(row.id)));
    const newlyAppliedIds = [];
    const migrationEntries = await readdir(migrationsDir, { withFileTypes: true }).catch(() => []);
    const migrationFiles = migrationEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

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
      newlyAppliedIds.push(migrationFile);
    }

    const finalRows = sqlite
      .prepare(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC, id ASC`)
      .all();

    return {
      appliedMigrationIds: finalRows.map((row) => String(row.id)),
      newlyAppliedIds,
    };
  } finally {
    sqlite.close();
  }
}

function getDatabaseArchiveExcludes(storageRoot, databasePath) {
  if (!isPathInside(storageRoot, databasePath)) {
    return [];
  }

  const relativeDatabasePath = toPosixRelative(path.relative(storageRoot, databasePath));

  return [`--exclude=${relativeDatabasePath}`, `--exclude=./${relativeDatabasePath}`];
}

async function writeManifest(backupDir, manifest) {
  const manifestPath = path.join(backupDir, MANIFEST_FILE_NAME);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

export async function createBackup({
  databasePath,
  deploymentMode,
  outputDir,
  repositoryRoot: sourceRepositoryRoot = repositoryRoot,
  storageRoot,
}) {
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedStorageRoot = path.resolve(storageRoot);
  const resolvedDatabasePath = path.resolve(databasePath);

  if (isPathInside(resolvedStorageRoot, resolvedOutputDir)) {
    throw new Error("Backup output must live outside the active storage root.");
  }

  await access(resolvedDatabasePath, fsConstants.R_OK);
  await access(resolvedStorageRoot, fsConstants.R_OK);
  await mkdir(resolvedOutputDir, { recursive: true });

  const backupDir = path.join(
    resolvedOutputDir,
    `critjecture-backup-${formatBackupTimestamp()}`,
  );
  await mkdir(backupDir, { recursive: false });

  const databaseArtifactPath = path.join(backupDir, DATABASE_ARTIFACT_NAME);
  const storageArtifactPath = path.join(backupDir, STORAGE_ARTIFACT_NAME);
  const sqlite = new Database(resolvedDatabasePath, { fileMustExist: true });
  sqlite.pragma("foreign_keys = ON");

  let appliedMigrationIds = [];

  try {
    appliedMigrationIds = sqlite
      .prepare(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC, id ASC`)
      .all()
      .map((row) => String(row.id));
    await sqlite.backup(databaseArtifactPath);
  } finally {
    sqlite.close();
  }

  await execFileAsync("tar", [
    "-czf",
    storageArtifactPath,
    ...getDatabaseArchiveExcludes(resolvedStorageRoot, resolvedDatabasePath),
    "-C",
    resolvedStorageRoot,
    ".",
  ]);

  const organizationSlugs = await listOrganizationSlugs(resolvedStorageRoot);
  const databaseStats = await stat(databaseArtifactPath);
  const storageStats = await stat(storageArtifactPath);
  const excludedPaths = isPathInside(resolvedStorageRoot, resolvedDatabasePath)
    ? [toPosixRelative(path.relative(resolvedStorageRoot, resolvedDatabasePath))]
    : [];
  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    deploymentMode: normalizeDeploymentMode(deploymentMode),
    source: {
      databasePath: resolvedDatabasePath,
      repositoryRoot: path.resolve(sourceRepositoryRoot),
      storageRoot: resolvedStorageRoot,
    },
    organizations: organizationSlugs,
    appliedMigrationIds,
    artifacts: {
      database: {
        fileName: DATABASE_ARTIFACT_NAME,
        sha256: await computeFileSha256(databaseArtifactPath),
        sizeBytes: databaseStats.size,
      },
      storageArchive: {
        fileName: STORAGE_ARTIFACT_NAME,
        sha256: await computeFileSha256(storageArtifactPath),
        sizeBytes: storageStats.size,
        excludedPaths,
      },
    },
  };
  const manifestPath = await writeManifest(backupDir, manifest);

  return {
    backupDir,
    manifest,
    manifestPath,
  };
}

export async function createBackupFromEnv({ outputDir, env = process.env } = {}) {
  const runtimePaths = getDefaultRuntimePaths(env);

  return createBackup({
    databasePath: runtimePaths.databasePath,
    deploymentMode: runtimePaths.deploymentMode,
    outputDir,
    repositoryRoot: runtimePaths.repositoryRoot,
    storageRoot: runtimePaths.storageRoot,
  });
}

export async function loadBackupManifest(backupDir) {
  const manifestPath = path.join(backupDir, MANIFEST_FILE_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (manifest?.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup manifest version: ${String(manifest?.formatVersion)}`);
  }

  return {
    manifest,
    manifestPath,
  };
}

export async function verifyBackupArtifacts(backupDir) {
  const { manifest } = await loadBackupManifest(backupDir);
  const databaseArtifactPath = path.join(backupDir, DATABASE_ARTIFACT_NAME);
  const storageArtifactPath = path.join(backupDir, STORAGE_ARTIFACT_NAME);

  await access(databaseArtifactPath, fsConstants.R_OK);
  await access(storageArtifactPath, fsConstants.R_OK);

  const [databaseSha256, storageSha256] = await Promise.all([
    computeFileSha256(databaseArtifactPath),
    computeFileSha256(storageArtifactPath),
  ]);

  if (databaseSha256 !== manifest.artifacts.database.sha256) {
    throw new Error("Backup database artifact checksum mismatch.");
  }

  if (storageSha256 !== manifest.artifacts.storageArchive.sha256) {
    throw new Error("Backup storage archive checksum mismatch.");
  }

  return {
    databaseArtifactPath,
    manifest,
    storageArtifactPath,
  };
}

export async function restoreBackup({
  backupDir,
  databasePath,
  migrationsDir = getDefaultMigrationsDir(),
  storageRoot,
}) {
  const resolvedBackupDir = path.resolve(backupDir);
  const resolvedDatabasePath = path.resolve(databasePath);
  const resolvedStorageRoot = path.resolve(storageRoot);
  const { manifest, databaseArtifactPath, storageArtifactPath } =
    await verifyBackupArtifacts(resolvedBackupDir);

  await ensureDirectoryEmpty(resolvedStorageRoot, "Restore storage root");
  await ensureFileMissing(resolvedDatabasePath, "Restore database file");

  await mkdir(resolvedStorageRoot, { recursive: true });
  await execFileAsync("tar", ["-xzf", storageArtifactPath, "-C", resolvedStorageRoot]);

  await mkdir(path.dirname(resolvedDatabasePath), { recursive: true });
  await copyFile(databaseArtifactPath, resolvedDatabasePath);

  const migrationState = await runMigrationsOnDatabasePath(resolvedDatabasePath, { migrationsDir });
  const restoredOrganizationSlugs = await listOrganizationSlugs(resolvedStorageRoot);

  return {
    databasePath: resolvedDatabasePath,
    manifest,
    migrationState,
    restoredOrganizationSlugs,
    storageRoot: resolvedStorageRoot,
  };
}

function insertUser(sqlite, { email, id, name, now, passwordHash, role }) {
  sqlite
    .prepare(
      "INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
    )
    .run(id, email, name, role, passwordHash, now, now);
}

function insertOrganization(sqlite, { id, name, now, slug }) {
  sqlite
    .prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, slug, now, now);
}

function insertMembership(sqlite, { id, now, organizationId, role, userId }) {
  sqlite
    .prepare(
      "INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, organizationId, userId, role, now, now);
}

function insertDocument(sqlite, {
  accessScope,
  byteSize,
  contentSha256,
  displayName,
  id,
  now,
  organizationId,
  sourcePath,
  uploadedByUserId,
}) {
  sqlite
    .prepare(
      [
        "INSERT INTO documents (",
        "id, organization_id, source_path, source_type, display_name, access_scope, ingestion_status,",
        "uploaded_by_user_id, content_sha256, mime_type, byte_size, created_at, updated_at, last_indexed_at",
        ") VALUES (?, ?, ?, 'uploaded', ?, ?, 'ready', ?, ?, 'text/plain', ?, ?, ?, ?)",
      ].join(" "),
    )
    .run(
      id,
      organizationId,
      sourcePath,
      displayName,
      accessScope,
      uploadedByUserId,
      contentSha256,
      byteSize,
      now,
      now,
      now,
    );
}

function insertGovernanceJob(sqlite, {
  artifactFileName,
  artifactStoragePath,
  id,
  now,
  organizationId,
  requestedByUserId,
}) {
  sqlite
    .prepare(
      [
        "INSERT INTO governance_jobs (",
        "id, organization_id, requested_by_user_id, job_type, status, trigger_kind, target_label,",
        "artifact_storage_path, artifact_file_name, artifact_byte_size, metadata_json, result_json,",
        "created_at, started_at, completed_at, updated_at",
        ") VALUES (?, ?, ?, 'organization_export', 'completed', 'manual', 'full_export', ?, ?, 64, '{}', '{}', ?, ?, ?, ?)",
      ].join(" "),
    )
    .run(id, organizationId, requestedByUserId, artifactStoragePath, artifactFileName, now, now, now, now);
}

function insertSandboxRun(sqlite, { now, organizationId, runId, userId }) {
  sqlite
    .prepare(
      [
        "INSERT INTO sandbox_runs (",
        "run_id, organization_id, user_id, tool_name, backend, runner, status, timeout_ms, cpu_limit_seconds, memory_limit_bytes,",
        "max_processes, stdout_max_bytes, artifact_max_bytes, artifact_ttl_ms, code_text, input_files_json, generated_assets_json,",
        "created_at, started_at, completed_at, cleanup_status, cleanup_completed_at",
        ") VALUES (?, ?, ?, 'run_data_analysis', 'local_supervisor', 'bubblewrap', 'completed', 30000, 30, 268435456,",
        "16, 1048576, 5242880, 3600000, 'print(\"ok\")', '[]', '[]', ?, ?, ?, 'completed', ?)",
      ].join(" "),
    )
    .run(runId, organizationId, userId, now, now, now, now);
}

function insertSandboxAsset(sqlite, { byteSize, fileName, now, relativePath, runId, storagePath }) {
  sqlite
    .prepare(
      [
        "INSERT INTO sandbox_generated_assets (",
        "id, run_id, relative_path, storage_path, file_name, mime_type, byte_size, created_at, expires_at",
        ") VALUES (?, ?, ?, ?, ?, 'text/plain', ?, ?, ?)",
      ].join(" "),
    )
    .run(randomUUID(), runId, relativePath, storagePath, fileName, byteSize, now, now + 3600000);
}

async function writeScenarioFile(rootDir, relativePath, content) {
  const targetPath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return {
    relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function createSingleOrgScenario(rootDir) {
  const storageRoot = path.join(rootDir, "storage");
  const databasePath = path.join(storageRoot, "critjecture.sqlite");
  const migrationState = await runMigrationsOnDatabasePath(databasePath);
  const now = Date.now();
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const internId = randomUUID();
  const sandboxRunId = randomUUID();
  const governanceJobId = randomUUID();
  const organizationSlug = "pilot-org";
  const organizationRoot = path.join("organizations", organizationSlug);
  const companyDataRelativePath = path.posix.join(
    organizationRoot,
    "company_data",
    "public",
    "uploads",
    "2026",
    "03",
    "backup-notes.txt",
  );
  const generatedAssetRelativePath = path.posix.join(
    organizationRoot,
    "generated_assets",
    sandboxRunId,
    "chart.txt",
  );
  const knowledgeStagingRelativePath = path.posix.join(
    organizationRoot,
    "knowledge_staging",
    "imports",
    randomUUID(),
    "archive",
    "staged.txt",
  );
  const governanceArtifactRelativePath = path.posix.join(
    organizationRoot,
    "governance",
    `export-${governanceJobId}.tar.gz`,
  );

  const fileContents = {
    companyData: `single-org company data ${organizationSlug}`,
    generatedAsset: `single-org generated asset ${sandboxRunId}`,
    governanceArtifact: `single-org governance artifact ${governanceJobId}`,
    knowledgeStaging: "single-org staged import file",
  };

  await mkdir(storageRoot, { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");

  try {
    insertOrganization(sqlite, {
      id: organizationId,
      name: "Pilot Org",
      now,
      slug: organizationSlug,
    });
    insertUser(sqlite, {
      email: "owner@pilot.example.com",
      id: ownerId,
      name: "Owner Pilot",
      now,
      passwordHash: "scrypt:test-owner",
      role: "owner",
    });
    insertUser(sqlite, {
      email: "intern@pilot.example.com",
      id: internId,
      name: "Intern Pilot",
      now,
      passwordHash: "scrypt:test-intern",
      role: "intern",
    });
    insertMembership(sqlite, {
      id: randomUUID(),
      now,
      organizationId,
      role: "owner",
      userId: ownerId,
    });
    insertMembership(sqlite, {
      id: randomUUID(),
      now,
      organizationId,
      role: "intern",
      userId: internId,
    });
    insertDocument(sqlite, {
      accessScope: "public",
      byteSize: Buffer.byteLength(fileContents.companyData),
      contentSha256: createHash("sha256").update(fileContents.companyData).digest("hex"),
      displayName: "backup-notes.txt",
      id: randomUUID(),
      now,
      organizationId,
      sourcePath: "public/uploads/2026/03/backup-notes.txt",
      uploadedByUserId: ownerId,
    });
    insertGovernanceJob(sqlite, {
      artifactFileName: `export-${governanceJobId}.tar.gz`,
      artifactStoragePath: path.posix.join("governance", `export-${governanceJobId}.tar.gz`),
      id: governanceJobId,
      now,
      organizationId,
      requestedByUserId: ownerId,
    });
    insertSandboxRun(sqlite, {
      now,
      organizationId,
      runId: sandboxRunId,
      userId: ownerId,
    });
    insertSandboxAsset(sqlite, {
      byteSize: Buffer.byteLength(fileContents.generatedAsset),
      fileName: "chart.txt",
      now,
      relativePath: "chart.txt",
      runId: sandboxRunId,
      storagePath: path.posix.join("generated_assets", sandboxRunId, "chart.txt"),
    });
  } finally {
    sqlite.close();
  }

  const files = [
    await writeScenarioFile(storageRoot, companyDataRelativePath, fileContents.companyData),
    await writeScenarioFile(storageRoot, generatedAssetRelativePath, fileContents.generatedAsset),
    await writeScenarioFile(storageRoot, knowledgeStagingRelativePath, fileContents.knowledgeStaging),
    await writeScenarioFile(storageRoot, governanceArtifactRelativePath, fileContents.governanceArtifact),
  ];

  return {
    databasePath,
    deploymentMode: "single_org",
    expected: {
      appliedMigrationIds: migrationState.appliedMigrationIds,
      files,
      organizationSlugs: [organizationSlug],
      tableCounts: {
        documents: 1,
        governance_jobs: 1,
        organization_memberships: 2,
        organizations: 1,
        sandbox_generated_assets: 1,
        sandbox_runs: 1,
        users: 2,
      },
    },
    storageRoot,
  };
}

async function createHostedScenario(rootDir) {
  const storageRoot = path.join(rootDir, "storage");
  const databasePath = path.join(storageRoot, "critjecture.sqlite");
  const migrationState = await runMigrationsOnDatabasePath(databasePath);
  const now = Date.now();
  const definitions = [
    {
      fileLabel: "alpha",
      name: "Alpha Org",
      ownerEmail: "owner@alpha.example.com",
      ownerName: "Owner Alpha",
      slug: "alpha-org",
    },
    {
      fileLabel: "beta",
      name: "Beta Org",
      ownerEmail: "owner@beta.example.com",
      ownerName: "Owner Beta",
      slug: "beta-org",
    },
  ];
  const files = [];

  await mkdir(storageRoot, { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");

  try {
    for (const definition of definitions) {
      const organizationId = randomUUID();
      const ownerId = randomUUID();
      const sandboxRunId = randomUUID();
      const governanceJobId = randomUUID();
      const organizationRoot = path.join("organizations", definition.slug);
      const companyDataText = `${definition.fileLabel} hosted company data`;
      const generatedAssetText = `${definition.fileLabel} hosted generated asset`;
      const knowledgeStagingText = `${definition.fileLabel} hosted staging file`;
      const governanceArtifactText = `${definition.fileLabel} hosted export artifact`;

      insertOrganization(sqlite, {
        id: organizationId,
        name: definition.name,
        now,
        slug: definition.slug,
      });
      insertUser(sqlite, {
        email: definition.ownerEmail,
        id: ownerId,
        name: definition.ownerName,
        now,
        passwordHash: `scrypt:${definition.fileLabel}`,
        role: "owner",
      });
      insertMembership(sqlite, {
        id: randomUUID(),
        now,
        organizationId,
        role: "owner",
        userId: ownerId,
      });
      insertDocument(sqlite, {
        accessScope: "admin",
        byteSize: Buffer.byteLength(companyDataText),
        contentSha256: createHash("sha256").update(companyDataText).digest("hex"),
        displayName: `${definition.fileLabel}-ledger.txt`,
        id: randomUUID(),
        now,
        organizationId,
        sourcePath: `admin/uploads/2026/03/${definition.fileLabel}-ledger.txt`,
        uploadedByUserId: ownerId,
      });
      insertGovernanceJob(sqlite, {
        artifactFileName: `export-${governanceJobId}.tar.gz`,
        artifactStoragePath: path.posix.join("governance", `export-${governanceJobId}.tar.gz`),
        id: governanceJobId,
        now,
        organizationId,
        requestedByUserId: ownerId,
      });
      insertSandboxRun(sqlite, {
        now,
        organizationId,
        runId: sandboxRunId,
        userId: ownerId,
      });
      insertSandboxAsset(sqlite, {
        byteSize: Buffer.byteLength(generatedAssetText),
        fileName: `${definition.fileLabel}-chart.txt`,
        now,
        relativePath: `${definition.fileLabel}-chart.txt`,
        runId: sandboxRunId,
        storagePath: path.posix.join(
          "generated_assets",
          sandboxRunId,
          `${definition.fileLabel}-chart.txt`,
        ),
      });

      files.push(
        await writeScenarioFile(
          storageRoot,
          path.posix.join(
            organizationRoot,
            "company_data",
            "admin",
            "uploads",
            "2026",
            "03",
            `${definition.fileLabel}-ledger.txt`,
          ),
          companyDataText,
        ),
      );
      files.push(
        await writeScenarioFile(
          storageRoot,
          path.posix.join(
            organizationRoot,
            "generated_assets",
            sandboxRunId,
            `${definition.fileLabel}-chart.txt`,
          ),
          generatedAssetText,
        ),
      );
      files.push(
        await writeScenarioFile(
          storageRoot,
          path.posix.join(
            organizationRoot,
            "knowledge_staging",
            "imports",
            randomUUID(),
            "archive",
            `${definition.fileLabel}-staged.txt`,
          ),
          knowledgeStagingText,
        ),
      );
      files.push(
        await writeScenarioFile(
          storageRoot,
          path.posix.join(
            organizationRoot,
            "governance",
            `export-${governanceJobId}.tar.gz`,
          ),
          governanceArtifactText,
        ),
      );
    }
  } finally {
    sqlite.close();
  }

  return {
    databasePath,
    deploymentMode: "hosted",
    expected: {
      appliedMigrationIds: migrationState.appliedMigrationIds,
      files,
      organizationSlugs: definitions.map((definition) => definition.slug).sort(),
      tableCounts: {
        documents: 2,
        governance_jobs: 2,
        organization_memberships: 2,
        organizations: 2,
        sandbox_generated_assets: 2,
        sandbox_runs: 2,
        users: 2,
      },
    },
    storageRoot,
  };
}

export async function inspectRuntimeState({ databasePath, storageRoot }) {
  const sqlite = new Database(databasePath, { fileMustExist: true, readonly: true });

  try {
    const getCount = (tableName) =>
      Number(sqlite.prepare(`SELECT count(*) AS count FROM ${tableName}`).get().count ?? 0);
    const tableCounts = {
      documents: getCount("documents"),
      governance_jobs: getCount("governance_jobs"),
      organization_memberships: getCount("organization_memberships"),
      organizations: getCount("organizations"),
      sandbox_generated_assets: getCount("sandbox_generated_assets"),
      sandbox_runs: getCount("sandbox_runs"),
      users: getCount("users"),
    };
    const appliedMigrationIds = sqlite
      .prepare(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC, id ASC`)
      .all()
      .map((row) => String(row.id));

    return {
      appliedMigrationIds,
      organizationSlugs: await listOrganizationSlugs(storageRoot),
      tableCounts,
    };
  } finally {
    sqlite.close();
  }
}

async function verifyScenarioFileSet(storageRoot, expectedFiles) {
  for (const expectedFile of expectedFiles) {
    const targetPath = path.join(storageRoot, expectedFile.relativePath);
    const actualSha256 = await computeFileSha256(targetPath).catch(() => null);

    if (actualSha256 !== expectedFile.sha256) {
      throw new Error(`Restored file mismatch for ${expectedFile.relativePath}.`);
    }
  }
}

function assertScenarioState(actualState, expectedState) {
  const expectedCounts = expectedState.tableCounts;

  for (const [tableName, expectedCount] of Object.entries(expectedCounts)) {
    if (actualState.tableCounts[tableName] !== expectedCount) {
      throw new Error(
        `Restored ${tableName} count mismatch. Expected ${expectedCount}, got ${actualState.tableCounts[tableName]}.`,
      );
    }
  }

  if (JSON.stringify(actualState.organizationSlugs) !== JSON.stringify(expectedState.organizationSlugs)) {
    throw new Error(
      `Restored organization slugs mismatch. Expected ${expectedState.organizationSlugs.join(", ")}, got ${actualState.organizationSlugs.join(", ")}.`,
    );
  }

  if (
    JSON.stringify(actualState.appliedMigrationIds) !==
    JSON.stringify(expectedState.appliedMigrationIds)
  ) {
    throw new Error("Restored migration set did not match the backup source.");
  }
}

async function runScenarioDrill(createScenario) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "critjecture-recovery-"));

  try {
    const scenario = await createScenario(rootDir);
    const backupsRoot = path.join(rootDir, "backups");
    const restoredStorageRoot = path.join(rootDir, "restored-storage");
    const restoredDatabasePath = path.join(restoredStorageRoot, "critjecture.sqlite");
    const backupResult = await createBackup({
      databasePath: scenario.databasePath,
      deploymentMode: scenario.deploymentMode,
      outputDir: backupsRoot,
      storageRoot: scenario.storageRoot,
    });
    const restoreResult = await restoreBackup({
      backupDir: backupResult.backupDir,
      databasePath: restoredDatabasePath,
      storageRoot: restoredStorageRoot,
    });
    const restoredState = await inspectRuntimeState({
      databasePath: restoreResult.databasePath,
      storageRoot: restoreResult.storageRoot,
    });

    assertScenarioState(restoredState, scenario.expected);
    await verifyScenarioFileSet(restoreResult.storageRoot, scenario.expected.files);

    return {
      backupDir: backupResult.backupDir,
      deploymentMode: scenario.deploymentMode,
      restoredOrganizationSlugs: restoredState.organizationSlugs,
      tableCounts: restoredState.tableCounts,
    };
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
}

export async function verifyBackupDrills({ deploymentMode = "both" } = {}) {
  const normalizedMode = String(deploymentMode).trim().toLowerCase() || "both";
  const results = [];

  if (normalizedMode === "single_org" || normalizedMode === "both") {
    results.push(await runScenarioDrill(createSingleOrgScenario));
  }

  if (normalizedMode === "hosted" || normalizedMode === "both") {
    results.push(await runScenarioDrill(createHostedScenario));
  }

  if (results.length === 0) {
    throw new Error('backup:verify supports deployment modes "single_org", "hosted", or "both".');
  }

  return {
    deploymentMode: normalizedMode,
    results,
  };
}
