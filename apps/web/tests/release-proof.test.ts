import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

type RecoveryModule = {
  runMigrationsOnDatabasePath: (databasePath: string) => Promise<void>;
};

type ReleaseProofModule = {
  createSingleOrgReleaseProof: (input: {
    alertWebhookOwner: string;
    backupEncryption: string;
    backupOutputDir?: string;
    buildRef?: string;
    changeScope: string;
    checklistKind: string;
    env?: NodeJS.ProcessEnv;
    environmentLabel: string;
    followUpItems?: string[];
    incidentContact: string;
    notes?: string;
    operatorName: string;
    outputDir?: string;
    restoreDrillPath: string;
    secretRotationOwner: string;
    secretStorageOwner: string;
    storageEncryption: string;
    tlsTermination: string;
  }) => Promise<{
    jsonPath: string;
    markdownPath: string;
    record: {
      recordType: string;
      verification: {
        backup: {
          backupDir: string;
        } | null;
        backupVerificationExecuted: boolean;
        backupVerificationRequired: boolean;
      };
    };
  }>;
  runSingleOrgRestoreDrill: (input: {
    backupOutputDir?: string;
    env?: NodeJS.ProcessEnv;
    environmentLabel: string;
    followUpItems?: string[];
    notes?: string;
    operatorName: string;
    outputDir?: string;
  }) => Promise<{
    jsonPath: string;
    markdownPath: string;
    record: {
      backup: {
        backupDir: string;
      };
      environmentLabel: string;
      operator: {
        name: string;
      };
      recordType: string;
      signoff: {
        followUpItems: string[];
        notes: string;
      };
    };
  }>;
};

let recoveryModulePromise: Promise<RecoveryModule> | null = null;
let releaseProofModulePromise: Promise<ReleaseProofModule> | null = null;

async function getRecoveryModule() {
  if (!recoveryModulePromise) {
    // @ts-expect-error Recovery helpers are authored as ESM .mjs; tests use a typed wrapper.
    recoveryModulePromise = import("../scripts/lib/recovery.mjs");
  }

  return recoveryModulePromise;
}

async function getReleaseProofModule() {
  if (!releaseProofModulePromise) {
    // @ts-expect-error Release proof helpers are authored as ESM .mjs; tests use a typed wrapper.
    releaseProofModulePromise = import("../scripts/lib/release-proof.mjs");
  }

  return releaseProofModulePromise;
}

const tempRoots = new Set<string>();

async function createTempRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "critjecture-release-proof-test-"));
  tempRoots.add(rootDir);
  return rootDir;
}

async function seedRuntimeFixture(rootDir: string) {
  const storageRoot = path.join(rootDir, "storage");
  const databasePath = path.join(storageRoot, "critjecture.sqlite");
  const now = Date.now();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const organizationSlug = "release-proof-org";
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
  const companyFileContent = "release proof content";

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
      .run(organizationId, "Release Proof Org", organizationSlug, now, now);
    sqlite
      .prepare(
        "INSERT INTO users (id, email, name, role, status, password_hash, created_at, updated_at) VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?)",
      )
      .run(
        userId,
        "owner@release-proof.example.com",
        "Release Proof Owner",
        "scrypt:fixture",
        now,
        now,
      );
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
    databasePath,
    organizationSlug,
    storageRoot,
  };
}

function createSingleOrgEnv(fixture: Awaited<ReturnType<typeof seedRuntimeFixture>>) {
  return {
    CRITJECTURE_ALERT_WEBHOOK_URL: "https://alerts.example.com/critjecture",
    CRITJECTURE_DEPLOYMENT_MODE: "single_org",
    CRITJECTURE_STORAGE_ROOT: fixture.storageRoot,
    DATABASE_URL: fixture.databasePath,
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

describe("single_org release proof", () => {
  it("writes restore drill JSON and Markdown artifacts", async () => {
    const { runSingleOrgRestoreDrill } = await getReleaseProofModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const env = createSingleOrgEnv(fixture);
    const proofOutputDir = path.join(rootDir, "release-records");
    const backupOutputDir = path.join(rootDir, "backups");

    const result = await runSingleOrgRestoreDrill({
      backupOutputDir,
      env,
      environmentLabel: "prod-east",
      followUpItems: ["verify pager rotation"],
      notes: "Completed before maintenance window.",
      operatorName: "Pat Operator",
      outputDir: proofOutputDir,
    });
    const jsonRecord = JSON.parse(await readFile(result.jsonPath, "utf8"));
    const markdown = await readFile(result.markdownPath, "utf8");

    expect(result.record.recordType).toBe("single_org_restore_drill");
    expect(result.record.environmentLabel).toBe("prod-east");
    expect(result.record.operator.name).toBe("Pat Operator");
    expect(result.record.signoff.followUpItems).toEqual(["verify pager rotation"]);
    expect(result.record.signoff.notes).toBe("Completed before maintenance window.");
    expect(jsonRecord.recordType).toBe("single_org_restore_drill");
    expect(markdown).toContain("# Single-Org Restore Drill");
    expect(markdown).toContain("prod-east");
    await expect(stat(result.record.backup.backupDir)).resolves.toBeDefined();
  });

  it("rejects release proofs without a restore drill reference", async () => {
    const { createSingleOrgReleaseProof } = await getReleaseProofModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const env = createSingleOrgEnv(fixture);

    await expect(
      createSingleOrgReleaseProof({
        alertWebhookOwner: "Ops",
        backupEncryption: "Encrypted operator-managed volume",
        changeScope: "app_only",
        checklistKind: "routine_upgrade",
        env,
        environmentLabel: "prod-east",
        incidentContact: "oncall@example.com",
        operatorName: "Pat Operator",
        restoreDrillPath: "",
        secretRotationOwner: "Security",
        secretStorageOwner: "Platform",
        storageEncryption: "Encrypted attached disk",
        tlsTermination: "Managed reverse proxy",
      }),
    ).rejects.toThrow("Restore drill path is required.");
  });

  it("rejects release proofs when operator responsibilities are incomplete", async () => {
    const { createSingleOrgReleaseProof, runSingleOrgRestoreDrill } =
      await getReleaseProofModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const env = createSingleOrgEnv(fixture);
    const restoreDrill = await runSingleOrgRestoreDrill({
      backupOutputDir: path.join(rootDir, "backups"),
      env,
      environmentLabel: "prod-east",
      operatorName: "Pat Operator",
      outputDir: path.join(rootDir, "release-records"),
    });

    await expect(
      createSingleOrgReleaseProof({
        alertWebhookOwner: "Ops",
        backupEncryption: "Encrypted operator-managed volume",
        changeScope: "app_only",
        checklistKind: "routine_upgrade",
        env,
        environmentLabel: "prod-east",
        incidentContact: "oncall@example.com",
        operatorName: "Pat Operator",
        restoreDrillPath: restoreDrill.jsonPath,
        secretRotationOwner: "Security",
        secretStorageOwner: "",
        storageEncryption: "Encrypted attached disk",
        tlsTermination: "Managed reverse proxy",
      }),
    ).rejects.toThrow("Secret storage owner is required.");
  });

  it("creates an app_only release proof without fresh backup verification", async () => {
    const { createSingleOrgReleaseProof, runSingleOrgRestoreDrill } =
      await getReleaseProofModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const env = createSingleOrgEnv(fixture);
    const restoreDrill = await runSingleOrgRestoreDrill({
      backupOutputDir: path.join(rootDir, "restore-drill-backups"),
      env,
      environmentLabel: "prod-east",
      operatorName: "Pat Operator",
      outputDir: path.join(rootDir, "restore-drill-records"),
    });
    const appOnlyBackupDir = path.join(rootDir, "app-only-backups");
    const result = await createSingleOrgReleaseProof({
      alertWebhookOwner: "Ops",
      backupEncryption: "Encrypted operator-managed volume",
      backupOutputDir: appOnlyBackupDir,
      buildRef: "2026.03.30.1",
      changeScope: "app_only",
      checklistKind: "routine_upgrade",
      env,
      environmentLabel: "prod-east",
      incidentContact: "oncall@example.com",
      notes: "No schema or storage changes.",
      operatorName: "Pat Operator",
      outputDir: path.join(rootDir, "release-proof-records"),
      restoreDrillPath: restoreDrill.jsonPath,
      secretRotationOwner: "Security",
      secretStorageOwner: "Platform",
      storageEncryption: "Encrypted attached disk",
      tlsTermination: "Managed reverse proxy",
    });
    const backupDirExists = await stat(appOnlyBackupDir)
      .then(() => true)
      .catch(() => false);

    expect(result.record.recordType).toBe("single_org_release_proof");
    expect(result.record.verification.backupVerificationRequired).toBe(false);
    expect(result.record.verification.backupVerificationExecuted).toBe(false);
    expect(result.record.verification.backup).toBeNull();
    expect(backupDirExists).toBe(false);
  });

  it("creates a migration release proof with fresh backup verification", async () => {
    const { createSingleOrgReleaseProof, runSingleOrgRestoreDrill } =
      await getReleaseProofModule();
    const rootDir = await createTempRoot();
    const fixture = await seedRuntimeFixture(rootDir);
    const env = createSingleOrgEnv(fixture);
    const restoreDrill = await runSingleOrgRestoreDrill({
      backupOutputDir: path.join(rootDir, "restore-drill-backups"),
      env,
      environmentLabel: "prod-east",
      operatorName: "Pat Operator",
      outputDir: path.join(rootDir, "restore-drill-records"),
    });
    const verificationBackupDir = path.join(rootDir, "migration-backups");
    const result = await createSingleOrgReleaseProof({
      alertWebhookOwner: "Ops",
      backupEncryption: "Encrypted operator-managed volume",
      backupOutputDir: verificationBackupDir,
      buildRef: "2026.03.30.2",
      changeScope: "migration",
      checklistKind: "routine_upgrade",
      env,
      environmentLabel: "prod-east",
      followUpItems: ["confirm alert delivery"],
      incidentContact: "oncall@example.com",
      operatorName: "Pat Operator",
      outputDir: path.join(rootDir, "release-proof-records"),
      restoreDrillPath: restoreDrill.jsonPath,
      secretRotationOwner: "Security",
      secretStorageOwner: "Platform",
      storageEncryption: "Encrypted attached disk",
      tlsTermination: "Managed reverse proxy",
    });
    const backupEntries = await readdir(verificationBackupDir);

    expect(result.record.verification.backupVerificationRequired).toBe(true);
    expect(result.record.verification.backupVerificationExecuted).toBe(true);
    expect(result.record.verification.backup?.backupDir).toBeTruthy();
    expect(backupEntries.length).toBeGreaterThan(0);
  });
});
