import "server-only";

import { getAppDatabaseRuntimeMetadata } from "@/lib/app-db";
import { resolveStorageRoot } from "@/lib/app-paths";
import { getDeploymentMode, type DeploymentMode } from "@/lib/deployment-mode";
import {
  SANDBOX_MAX_ACTIVE_RUNS_GLOBAL,
  SANDBOX_MAX_ACTIVE_RUNS_PER_USER,
} from "@/lib/sandbox-policy";

export type RuntimePersistenceSnapshot = {
  backupCadenceHours: number;
  backupBeforeSchemaChanges: boolean;
  databasePath: string;
  deploymentMode: DeploymentMode;
  engine: "sqlite";
  journalMode: string;
  requestModel: "synchronous_requests_only";
  restoreDrillCadence: "before_first_cutover_and_quarterly";
  sandboxConcurrency: {
    globalActiveRuns: number;
    perUserActiveRuns: number;
  };
  storageRoot: string;
  targetRpoHours: number;
  targetRtoHours: number;
  topology:
    | "single_writer_customer_managed_cell"
    | "single_writer_dedicated_hosted_cell";
  writableAppInstances: number;
};

export const HOSTED_PERSISTENCE_ENVELOPE = {
  backupCadenceHours: 24,
  backupBeforeSchemaChanges: true,
  restoreDrillCadence: "before_first_cutover_and_quarterly",
  requestModel: "synchronous_requests_only",
  targetRpoHours: 24,
  targetRtoHours: 2,
  writableAppInstances: 1,
} as const;

function getTopology(deploymentMode: DeploymentMode): RuntimePersistenceSnapshot["topology"] {
  return deploymentMode === "hosted"
    ? "single_writer_dedicated_hosted_cell"
    : "single_writer_customer_managed_cell";
}

export async function getRuntimePersistenceSnapshot(): Promise<RuntimePersistenceSnapshot> {
  const deploymentMode = getDeploymentMode();
  const [{ databasePath, journalMode }, storageRoot] = await Promise.all([
    getAppDatabaseRuntimeMetadata(),
    resolveStorageRoot(),
  ]);

  return {
    backupCadenceHours: HOSTED_PERSISTENCE_ENVELOPE.backupCadenceHours,
    backupBeforeSchemaChanges: HOSTED_PERSISTENCE_ENVELOPE.backupBeforeSchemaChanges,
    databasePath,
    deploymentMode,
    engine: "sqlite",
    journalMode,
    requestModel: HOSTED_PERSISTENCE_ENVELOPE.requestModel,
    restoreDrillCadence: HOSTED_PERSISTENCE_ENVELOPE.restoreDrillCadence,
    sandboxConcurrency: {
      globalActiveRuns: SANDBOX_MAX_ACTIVE_RUNS_GLOBAL,
      perUserActiveRuns: SANDBOX_MAX_ACTIVE_RUNS_PER_USER,
    },
    storageRoot,
    targetRpoHours: HOSTED_PERSISTENCE_ENVELOPE.targetRpoHours,
    targetRtoHours: HOSTED_PERSISTENCE_ENVELOPE.targetRtoHours,
    topology: getTopology(deploymentMode),
    writableAppInstances: HOSTED_PERSISTENCE_ENVELOPE.writableAppInstances,
  };
}
