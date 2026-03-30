import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

type BackupManifest = {
  artifacts: {
    database: {
      sha256: string;
    };
  };
  organizations: string[];
};

type RecoveryModule = {
  createBackup: (input: {
    databasePath: string;
    deploymentMode: "hosted" | "single_org";
    outputDir: string;
    storageRoot: string;
  }) => Promise<{
    backupDir: string;
    manifest: BackupManifest;
  }>;
  inspectRuntimeState: (input: {
    databasePath: string;
    storageRoot: string;
  }) => Promise<{
    organizationSlugs: string[];
    tableCounts: Record<string, number>;
  }>;
  loadBackupManifest: (backupDir: string) => Promise<{
    manifest: BackupManifest;
    manifestPath: string;
  }>;
  restoreBackup: (input: {
    backupDir: string;
    databasePath: string;
    storageRoot: string;
  }) => Promise<{
    databasePath: string;
    storageRoot: string;
  }>;
  runMigrationsOnDatabasePath: (databasePath: string) => Promise<void>;
  verifyBackupDrills: (input?: {
    deploymentMode?: "both" | "hosted" | "single_org";
  }) => Promise<{
    results: Array<{
      deploymentMode: "hosted" | "single_org";
    }>;
  }>;
};

let recoveryModulePromise: Promise<RecoveryModule> | null = null;

async function getRecoveryModule() {
  if (!recoveryModulePromise) {
    // @ts-expect-error The backup helper is authored as ESM .mjs; tests use a typed wrapper.
    recoveryModulePromise = import("../scripts/lib/recovery.mjs");
  }

  return recoveryModulePromise;
}

const tempRoots = new Set<string>();

async function createTempRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "critjecture-backup-test-"));
  tempRoots.add(rootDir);
  return rootDir;
}

async function seedRuntimeFixture(rootDir: string) {
  const storageRoot = path.join(rootDir, "storage");
  const databasePath = path.join(storageRoot, "critjecture.sqlite");
  const now = Date.now();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const organizationSlug = "fixture-org";
  const companyFileRelativePath = path.posix.join(
    "organizations",
    organizationSlug,
    "company_data",
    "public",
    "uploads",
    "2026",
    "03",
    "fixture.txt",
  );
  const companyFileContent = "fixture backup content";

  await mkdir(storageRoot, { recursive: true });
  const { runMigrationsOnDatabasePath } = await getRecoveryModule();
  await runMigrationsOnDatabasePath(databasePath);

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");

  try {
    sqlite
      .prepare(
        "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(organizationId, "Fixture Org", organizationSlug, now, now);
    sqlite
      .prepare(
        "INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?)",
      )
      .run(userId, "owner@fixture.example.com", "Fixture Owner", "scrypt:fixture", now, now);
    sqlite
      .prepare(
        "INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'owner', ?, ?)",
      )
      .run(randomUUID(), organizationId, userId, now, now);
  } finally {
    sqlite.close();
  }

  const companyFilePath = path.join(storageRoot, companyFileRelativePath);
  await mkdir(path.dirname(companyFilePath), { recursive: true });
  await writeFile(companyFilePath, companyFileContent);

  return {
    companyFileContent,
    companyFileRelativePath,
    databasePath,
    organizationSlug,
    storageRoot,
  };
}

afterEach(async () => {
  await Promise.all(
    [...tempRoots].map(async (rootDir) => {
      await rm(rootDir, { force: true, recursive: true });
      tempRoots.delete(rootDir);
    }),
  );
});

describe("backup recovery", () => {
  it("creates and restores a clean runtime backup", async () => {
    const { createBackup, inspectRuntimeState, restoreBackup } = await getRecoveryModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const backupRoot = path.join(rootDir, "backups");
    const restoredStorageRoot = path.join(rootDir, "restored-storage");
    const restoredDatabasePath = path.join(restoredStorageRoot, "critjecture.sqlite");

    const backupResult = await createBackup({
      databasePath: fixture.databasePath,
      deploymentMode: "single_org",
      outputDir: backupRoot,
      storageRoot: fixture.storageRoot,
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
    const restoredFileContent = await readFile(
      path.join(restoredStorageRoot, fixture.companyFileRelativePath),
      "utf8",
    );

    expect(backupResult.manifest.organizations).toEqual([fixture.organizationSlug]);
    expect(restoredState.tableCounts.organizations).toBe(1);
    expect(restoredState.tableCounts.users).toBe(1);
    expect(restoredState.tableCounts.organization_memberships).toBe(1);
    expect(restoredState.organizationSlugs).toEqual([fixture.organizationSlug]);
    expect(restoredFileContent).toBe(fixture.companyFileContent);
  });

  it("rejects backup output paths inside the active storage root", async () => {
    const { createBackup } = await getRecoveryModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);

    await expect(
      createBackup({
        databasePath: fixture.databasePath,
        deploymentMode: "single_org",
        outputDir: path.join(fixture.storageRoot, "backups"),
        storageRoot: fixture.storageRoot,
      }),
    ).rejects.toThrow("Backup output must live outside the active storage root.");
  });

  it("rejects restoring into non-empty target storage", async () => {
    const { createBackup, restoreBackup } = await getRecoveryModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const backupRoot = path.join(rootDir, "backups");
    const restoredStorageRoot = path.join(rootDir, "restored-storage");

    const backupResult = await createBackup({
      databasePath: fixture.databasePath,
      deploymentMode: "single_org",
      outputDir: backupRoot,
      storageRoot: fixture.storageRoot,
    });

    await mkdir(restoredStorageRoot, { recursive: true });
    await writeFile(path.join(restoredStorageRoot, "existing.txt"), "not empty");

    await expect(
      restoreBackup({
        backupDir: backupResult.backupDir,
        databasePath: path.join(restoredStorageRoot, "critjecture.sqlite"),
        storageRoot: restoredStorageRoot,
      }),
    ).rejects.toThrow("Restore storage root must be empty before restore.");
  });

  it("rejects checksum mismatches before restore", async () => {
    const { createBackup, loadBackupManifest, restoreBackup } = await getRecoveryModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const backupRoot = path.join(rootDir, "backups");
    const restoredStorageRoot = path.join(rootDir, "restored-storage");

    const backupResult = await createBackup({
      databasePath: fixture.databasePath,
      deploymentMode: "single_org",
      outputDir: backupRoot,
      storageRoot: fixture.storageRoot,
    });
    const { manifest, manifestPath } = await loadBackupManifest(backupResult.backupDir);

    manifest.artifacts.database.sha256 = "corrupted";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(
      restoreBackup({
        backupDir: backupResult.backupDir,
        databasePath: path.join(restoredStorageRoot, "critjecture.sqlite"),
        storageRoot: restoredStorageRoot,
      }),
    ).rejects.toThrow("Backup database artifact checksum mismatch.");
  });

  it("runs recovery drills for both single_org and hosted modes", async () => {
    const { verifyBackupDrills } = await getRecoveryModule();
    const result = await verifyBackupDrills({ deploymentMode: "both" });

    expect(result.results).toHaveLength(2);
    expect(result.results.map((entry) => entry.deploymentMode).sort()).toEqual([
      "hosted",
      "single_org",
    ]);
  });
});
