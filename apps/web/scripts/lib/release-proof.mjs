import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  createBackupFromEnv,
  getDefaultRuntimePaths,
  restoreBackup,
} from "./recovery.mjs";

const execFileAsync = promisify(execFile);

const RELEASE_PROOF_FORMAT_VERSION = 1;
const RESTORE_DRILL_RECORD_TYPE = "single_org_restore_drill";
const RELEASE_PROOF_RECORD_TYPE = "single_org_release_proof";

function formatRecordTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function requireNonEmpty(value, label) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function normalizeChecklistKind(value) {
  const normalized = requireNonEmpty(value, "Checklist kind").toLowerCase();

  if (normalized === "first_customer_deployment" || normalized === "routine_upgrade") {
    return normalized;
  }

  throw new Error(
    'Checklist kind must be "first_customer_deployment" or "routine_upgrade".',
  );
}

function normalizeChangeScope(value) {
  const normalized = requireNonEmpty(value, "Change scope").toLowerCase();

  if (
    normalized === "app_only" ||
    normalized === "migration" ||
    normalized === "storage_layout" ||
    normalized === "migration_and_storage"
  ) {
    return normalized;
  }

  throw new Error(
    'Change scope must be "app_only", "migration", "storage_layout", or "migration_and_storage".',
  );
}

function parseFollowUpItems(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeFileSegment(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "record";
}

function ensureSingleOrgRuntime(runtimePaths) {
  if (runtimePaths.deploymentMode !== "single_org") {
    throw new Error("Step 27 release proof tooling supports single_org deployments only.");
  }
}

function summarizeBackupManifest(manifest) {
  return {
    appliedMigrationIds: [...manifest.appliedMigrationIds],
    artifacts: manifest.artifacts,
    createdAt: manifest.createdAt,
    deploymentMode: manifest.deploymentMode,
    formatVersion: manifest.formatVersion,
    organizations: [...manifest.organizations],
    source: manifest.source,
  };
}

function summarizeRestoreValidation(restoreResult) {
  return {
    migrationValidation: {
      appliedMigrationIds: [...restoreResult.migrationState.appliedMigrationIds],
      newlyAppliedIds: [...restoreResult.migrationState.newlyAppliedIds],
    },
    restoredOrganizationSlugs: [...restoreResult.restoredOrganizationSlugs],
    validatedUsingCleanTemporaryRestore: true,
  };
}

function buildRecordPaths({ outputDir, recordType, suffix }) {
  const timestamp = formatRecordTimestamp();
  const baseName = `${sanitizeFileSegment(recordType)}-${sanitizeFileSegment(suffix)}-${timestamp}`;

  return {
    jsonPath: path.join(outputDir, `${baseName}.json`),
    markdownPath: path.join(outputDir, `${baseName}.md`),
  };
}

async function writeRecordArtifacts({ markdown, outputDir, record, suffix }) {
  const resolvedOutputDir = path.resolve(outputDir);
  await mkdir(resolvedOutputDir, { recursive: true });

  const paths = buildRecordPaths({
    outputDir: resolvedOutputDir,
    recordType: record.recordType,
    suffix,
  });

  await writeFile(paths.jsonPath, JSON.stringify(record, null, 2));
  await writeFile(paths.markdownPath, markdown);

  return {
    jsonPath: paths.jsonPath,
    markdownPath: paths.markdownPath,
    outputDir: resolvedOutputDir,
  };
}

function getDefaultProofOutputDir(runtimePaths) {
  return path.join(runtimePaths.repositoryRoot, "release-records");
}

function getDefaultBackupOutputDir(runtimePaths) {
  return path.join(runtimePaths.repositoryRoot, "backups");
}

async function runRealBackupRestoreVerification({
  backupOutputDir,
  env,
  runtimePaths,
}) {
  const backupResult = await createBackupFromEnv({
    env,
    outputDir: backupOutputDir,
  });
  const restoreTempRoot = await mkdtemp(
    path.join(os.tmpdir(), "critjecture-single-org-release-proof-"),
  );

  try {
    const restoredStorageRoot = path.join(restoreTempRoot, "restored-storage");
    const restoredDatabasePath = path.join(restoredStorageRoot, "critjecture.sqlite");
    const restoreResult = await restoreBackup({
      backupDir: backupResult.backupDir,
      databasePath: restoredDatabasePath,
      migrationsDir: runtimePaths.migrationsDir,
      storageRoot: restoredStorageRoot,
    });

    return {
      backup: {
        backupDir: backupResult.backupDir,
        manifest: summarizeBackupManifest(backupResult.manifest),
      },
      restoreValidation: summarizeRestoreValidation(restoreResult),
    };
  } finally {
    await rm(restoreTempRoot, { force: true, recursive: true });
  }
}

async function resolveGitSha(repositoryRoot) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
    });

    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function buildRestoreDrillMarkdown(record, artifactPaths) {
  const lines = [
    "# Single-Org Restore Drill",
    "",
    `- Environment: ${record.environmentLabel}`,
    `- Operator: ${record.operator.name}`,
    `- Executed at: ${record.executedAt}`,
    `- Deployment mode: ${record.runtime.deploymentMode}`,
    `- Backup directory: ${record.backup.backupDir}`,
    `- Organizations restored: ${record.restoreValidation.restoredOrganizationSlugs.join(", ") || "none"}`,
    `- Migration validation reapplied: ${record.restoreValidation.migrationValidation.newlyAppliedIds.length > 0 ? "yes" : "no"}`,
    `- Notes: ${record.signoff.notes || "None"}`,
    `- Follow-up items: ${
      record.signoff.followUpItems.length > 0
        ? record.signoff.followUpItems.join("; ")
        : "None"
    }`,
    "",
    `JSON record: ${artifactPaths.jsonPath}`,
  ];

  return `${lines.join("\n")}\n`;
}

function buildReleaseProofMarkdown(record, artifactPaths) {
  const lines = [
    "# Single-Org Release Proof",
    "",
    `- Environment: ${record.environmentLabel}`,
    `- Operator: ${record.operator.name}`,
    `- Executed at: ${record.executedAt}`,
    `- Checklist kind: ${record.checklistKind}`,
    `- Change scope: ${record.changeScope}`,
    `- Backup verification required: ${record.verification.backupVerificationRequired ? "yes" : "no"}`,
    `- Backup verification executed: ${record.verification.backupVerificationExecuted ? "yes" : "no"}`,
    `- Referenced restore drill: ${record.referencedRestoreDrill.recordPath}`,
    `- Secret storage owner: ${record.operatorResponsibilities.secretStorageOwner}`,
    `- Secret rotation owner: ${record.operatorResponsibilities.secretRotationOwner}`,
    `- TLS termination: ${record.operatorResponsibilities.tlsTermination}`,
    `- Storage encryption: ${record.operatorResponsibilities.storageEncryption}`,
    `- Backup encryption: ${record.operatorResponsibilities.backupEncryption}`,
    `- Alert webhook owner: ${record.operatorResponsibilities.alertWebhookOwner}`,
    `- Incident contact: ${record.operatorResponsibilities.incidentContact}`,
    `- Notes: ${record.signoff.notes || "None"}`,
    `- Follow-up items: ${
      record.signoff.followUpItems.length > 0
        ? record.signoff.followUpItems.join("; ")
        : "None"
    }`,
    "",
    `JSON record: ${artifactPaths.jsonPath}`,
  ];

  if (record.build.gitSha) {
    lines.splice(7, 0, `- Git SHA: ${record.build.gitSha}`);
  }

  if (record.build.buildRef) {
    lines.splice(7, 0, `- Build ref: ${record.build.buildRef}`);
  }

  if (record.verification.backup) {
    lines.splice(9, 0, `- Verification backup directory: ${record.verification.backup.backupDir}`);
  }

  return `${lines.join("\n")}\n`;
}

function validateRestoreDrillRecord(record, expectedEnvironmentLabel) {
  if (record?.recordType !== RESTORE_DRILL_RECORD_TYPE) {
    throw new Error("Referenced restore drill record is not a single_org restore drill.");
  }

  if (record.formatVersion !== RELEASE_PROOF_FORMAT_VERSION) {
    throw new Error(`Unsupported restore drill format version: ${String(record?.formatVersion)}`);
  }

  if (record.runtime?.deploymentMode !== "single_org") {
    throw new Error("Referenced restore drill was not recorded for a single_org runtime.");
  }

  if (record.environmentLabel !== expectedEnvironmentLabel) {
    throw new Error("Referenced restore drill environment does not match the requested environment.");
  }
}

export async function loadRestoreDrillRecord(recordPath) {
  const resolvedPath = path.resolve(requireNonEmpty(recordPath, "Restore drill path"));
  const record = JSON.parse(await readFile(resolvedPath, "utf8"));

  return {
    path: resolvedPath,
    record,
  };
}

export async function runSingleOrgRestoreDrill({
  backupOutputDir,
  env = process.env,
  environmentLabel,
  followUpItems = [],
  notes = "",
  operatorName,
  outputDir,
}) {
  const runtimePaths = getDefaultRuntimePaths(env);
  ensureSingleOrgRuntime(runtimePaths);

  const normalizedEnvironmentLabel = requireNonEmpty(environmentLabel, "Environment label");
  const normalizedOperatorName = requireNonEmpty(operatorName, "Operator name");
  const normalizedNotes = String(notes ?? "").trim();
  const normalizedFollowUpItems = followUpItems
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  const resolvedProofOutputDir = path.resolve(
    outputDir || getDefaultProofOutputDir(runtimePaths),
  );
  const resolvedBackupOutputDir = path.resolve(
    backupOutputDir || getDefaultBackupOutputDir(runtimePaths),
  );
  const verification = await runRealBackupRestoreVerification({
    backupOutputDir: resolvedBackupOutputDir,
    env,
    runtimePaths,
  });
  const executedAt = new Date().toISOString();
  const record = {
    backup: verification.backup,
    environmentLabel: normalizedEnvironmentLabel,
    executedAt,
    formatVersion: RELEASE_PROOF_FORMAT_VERSION,
    operator: {
      name: normalizedOperatorName,
    },
    recordType: RESTORE_DRILL_RECORD_TYPE,
    restoreValidation: verification.restoreValidation,
    runtime: {
      databasePath: runtimePaths.databasePath,
      deploymentMode: runtimePaths.deploymentMode,
      repositoryRoot: runtimePaths.repositoryRoot,
      storageRoot: runtimePaths.storageRoot,
    },
    signoff: {
      completedAt: executedAt,
      completedBy: normalizedOperatorName,
      followUpItems: normalizedFollowUpItems,
      notes: normalizedNotes,
      status: "completed",
    },
  };
  const artifactPaths = await writeRecordArtifacts({
    markdown: "",
    outputDir: resolvedProofOutputDir,
    record,
    suffix: normalizedEnvironmentLabel,
  });
  const markdown = buildRestoreDrillMarkdown(record, artifactPaths);
  await writeFile(artifactPaths.markdownPath, markdown);

  return {
    ...artifactPaths,
    record,
  };
}

function buildOperatorResponsibilities({
  alertWebhookOwner,
  backupEncryption,
  env,
  incidentContact,
  secretRotationOwner,
  secretStorageOwner,
  storageEncryption,
  tlsTermination,
}) {
  const configuredAlertWebhook = String(env.CRITJECTURE_ALERT_WEBHOOK_URL ?? "").trim();

  if (!configuredAlertWebhook) {
    throw new Error(
      "CRITJECTURE_ALERT_WEBHOOK_URL must be configured before creating a single_org release proof.",
    );
  }

  return {
    alertWebhookConfigured: true,
    alertWebhookOwner: requireNonEmpty(alertWebhookOwner, "Alert webhook owner"),
    backupEncryption: requireNonEmpty(backupEncryption, "Backup encryption expectation"),
    incidentContact: requireNonEmpty(incidentContact, "Incident contact"),
    secretRotationOwner: requireNonEmpty(secretRotationOwner, "Secret rotation owner"),
    secretStorageOwner: requireNonEmpty(secretStorageOwner, "Secret storage owner"),
    storageEncryption: requireNonEmpty(storageEncryption, "Storage encryption expectation"),
    tlsTermination: requireNonEmpty(tlsTermination, "TLS termination expectation"),
  };
}

function changeScopeRequiresBackupVerification(changeScope) {
  return changeScope === "migration" || changeScope === "storage_layout" || changeScope === "migration_and_storage";
}

export async function createSingleOrgReleaseProof({
  alertWebhookOwner,
  backupEncryption,
  backupOutputDir,
  buildRef = "",
  changeScope,
  checklistKind,
  env = process.env,
  environmentLabel,
  followUpItems = [],
  incidentContact,
  notes = "",
  operatorName,
  outputDir,
  restoreDrillPath,
  secretRotationOwner,
  secretStorageOwner,
  storageEncryption,
  tlsTermination,
}) {
  const runtimePaths = getDefaultRuntimePaths(env);
  ensureSingleOrgRuntime(runtimePaths);

  const normalizedEnvironmentLabel = requireNonEmpty(environmentLabel, "Environment label");
  const normalizedOperatorName = requireNonEmpty(operatorName, "Operator name");
  const normalizedChecklistKind = normalizeChecklistKind(checklistKind);
  const normalizedChangeScope = normalizeChangeScope(changeScope);
  const normalizedNotes = String(notes ?? "").trim();
  const normalizedFollowUpItems = followUpItems
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  const { path: resolvedRestoreDrillPath, record: restoreDrillRecord } =
    await loadRestoreDrillRecord(restoreDrillPath);
  validateRestoreDrillRecord(restoreDrillRecord, normalizedEnvironmentLabel);

  const operatorResponsibilities = buildOperatorResponsibilities({
    alertWebhookOwner,
    backupEncryption,
    env,
    incidentContact,
    secretRotationOwner,
    secretStorageOwner,
    storageEncryption,
    tlsTermination,
  });
  const resolvedProofOutputDir = path.resolve(
    outputDir || getDefaultProofOutputDir(runtimePaths),
  );
  const resolvedBackupOutputDir = path.resolve(
    backupOutputDir || getDefaultBackupOutputDir(runtimePaths),
  );
  const requiresBackupVerification = changeScopeRequiresBackupVerification(
    normalizedChangeScope,
  );
  const verification = requiresBackupVerification
    ? await runRealBackupRestoreVerification({
        backupOutputDir: resolvedBackupOutputDir,
        env,
        runtimePaths,
      })
    : null;
  const executedAt = new Date().toISOString();
  const record = {
    build: {
      buildRef: String(buildRef ?? "").trim() || null,
      gitSha: await resolveGitSha(runtimePaths.repositoryRoot),
    },
    changeScope: normalizedChangeScope,
    checklistKind: normalizedChecklistKind,
    environmentLabel: normalizedEnvironmentLabel,
    executedAt,
    formatVersion: RELEASE_PROOF_FORMAT_VERSION,
    operator: {
      name: normalizedOperatorName,
    },
    operatorResponsibilities,
    recordType: RELEASE_PROOF_RECORD_TYPE,
    referencedRestoreDrill: {
      environmentLabel: restoreDrillRecord.environmentLabel,
      executedAt: restoreDrillRecord.executedAt,
      operatorName: restoreDrillRecord.operator.name,
      recordPath: resolvedRestoreDrillPath,
    },
    runtime: {
      databasePath: runtimePaths.databasePath,
      deploymentMode: runtimePaths.deploymentMode,
      repositoryRoot: runtimePaths.repositoryRoot,
      storageRoot: runtimePaths.storageRoot,
    },
    signoff: {
      approvedAt: executedAt,
      approvedBy: normalizedOperatorName,
      followUpItems: normalizedFollowUpItems,
      notes: normalizedNotes,
      status: "approved",
    },
    verification: {
      backup: verification?.backup ?? null,
      backupVerificationExecuted: verification !== null,
      backupVerificationRequired: requiresBackupVerification,
      restoreValidation: verification?.restoreValidation ?? null,
    },
  };
  const artifactPaths = await writeRecordArtifacts({
    markdown: "",
    outputDir: resolvedProofOutputDir,
    record,
    suffix: `${normalizedChecklistKind}-${normalizedEnvironmentLabel}`,
  });
  const markdown = buildReleaseProofMarkdown(record, artifactPaths);
  await writeFile(artifactPaths.markdownPath, markdown);

  return {
    ...artifactPaths,
    record,
  };
}

export function getReleaseProofCliDefaults(env = process.env) {
  const runtimePaths = getDefaultRuntimePaths(env);

  return {
    backupOutputDir: getDefaultBackupOutputDir(runtimePaths),
    outputDir: getDefaultProofOutputDir(runtimePaths),
    runtimePaths,
  };
}

export function parseFollowUpItemsArg(value) {
  return parseFollowUpItems(value);
}
