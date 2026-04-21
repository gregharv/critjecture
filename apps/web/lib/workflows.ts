import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { workflowVersions, workflows } from "@/lib/legacy-app-schema";
import { computeNextScheduledRunAt } from "@/lib/workflow-schedule";
import {
  parseWorkflowScheduleJson,
  parseWorkflowVersionContracts,
  type WorkflowScheduleV1,
  type WorkflowStatus,
  type WorkflowVersionContractsV1,
  type WorkflowVisibility,
} from "@/lib/workflow-types";
import { getWorkspacePlanSummary } from "@/lib/workspace-plans";

export type WorkflowVersionSummary = {
  createdAt: number;
  createdByUserId: string | null;
  id: string;
  versionNumber: number;
};

export type WorkflowVersionRecord = WorkflowVersionSummary & {
  contracts: WorkflowVersionContractsV1;
};

export type WorkflowRecord = {
  createdAt: number;
  createdByUserId: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  description: string | null;
  id: string;
  lastEnabledByUserId: string | null;
  lastRunAt: number | null;
  name: string;
  nextRunAt: number | null;
  organizationId: string;
  status: WorkflowStatus;
  updatedAt: number;
  visibility: WorkflowVisibility;
};

export type WorkflowDetailRecord = {
  currentVersion: WorkflowVersionRecord | null;
  versions: WorkflowVersionSummary[];
  workflow: WorkflowRecord;
};

export type WorkflowVersionInput = {
  delivery: unknown;
  executionIdentity: unknown;
  inputBindings: unknown;
  inputContract: unknown;
  outputs: unknown;
  provenance?: unknown;
  recipe: unknown;
  schedule: unknown;
  thresholds: unknown;
};

type PersistedWorkflowContracts = {
  deliveryJson: string;
  executionIdentityJson: string;
  inputBindingsJson: string;
  inputContractJson: string;
  outputsJson: string;
  provenanceJson: string;
  recipeJson: string;
  scheduleJson: string;
  thresholdsJson: string;
};

function normalizeName(name: string) {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Workflow name is required.");
  }

  return normalized.slice(0, 200);
}

function normalizeDescription(description: string | null | undefined) {
  if (typeof description === "undefined" || description === null) {
    return null;
  }

  const normalized = description.trim();
  return normalized ? normalized.slice(0, 8_000) : null;
}

function buildDefaultVersionContracts(runAsUserId: string): WorkflowVersionContractsV1 {
  return {
    delivery: {
      channels: [],
      retry_policy: {
        backoff_multiplier: 2,
        initial_backoff_seconds: 30,
        max_attempts: 3,
      },
      schema_version: 1,
    },
    executionIdentity: {
      mode: "fixed_membership_user",
      on_identity_invalid: "block_run",
      recheck_at_enqueue: true,
      recheck_at_execution: true,
      required_membership_roles: ["admin", "owner"],
      require_membership_status: "active",
      run_as_user_id: runAsUserId,
      schema_version: 1,
    },
    inputBindings: {
      bindings: [],
      schema_version: 1,
    },
    inputContract: {
      inputs: [],
      schema_version: 1,
    },
    outputs: {
      schema_version: 1,
      summary_template: "standard_v1",
    },
    provenance: {
      schema_version: 1,
      source_kind: "manual_builder",
    },
    recipe: {
      schema_version: 1,
      steps: [],
    },
    schedule: {
      kind: "manual_only",
      schema_version: 1,
    },
    thresholds: {
      rules: [],
      schema_version: 1,
    },
  };
}

function normalizeVersionInput(
  input: WorkflowVersionInput | undefined,
  runAsUserId: string,
): WorkflowVersionContractsV1 {
  if (!input) {
    return buildDefaultVersionContracts(runAsUserId);
  }

  return parseWorkflowVersionContracts({
    deliveryJson: input.delivery,
    executionIdentityJson: input.executionIdentity,
    inputBindingsJson: input.inputBindings,
    inputContractJson: input.inputContract,
    outputsJson: input.outputs,
    provenanceJson: input.provenance ?? {
      schema_version: 1,
      source_kind: "manual_builder",
    },
    recipeJson: input.recipe,
    scheduleJson: input.schedule,
    thresholdsJson: input.thresholds,
  });
}

function toPersistedWorkflowContracts(
  contracts: WorkflowVersionContractsV1,
): PersistedWorkflowContracts {
  return {
    deliveryJson: JSON.stringify(contracts.delivery),
    executionIdentityJson: JSON.stringify(contracts.executionIdentity),
    inputBindingsJson: JSON.stringify(contracts.inputBindings),
    inputContractJson: JSON.stringify(contracts.inputContract),
    outputsJson: JSON.stringify(contracts.outputs),
    provenanceJson: JSON.stringify(contracts.provenance),
    recipeJson: JSON.stringify(contracts.recipe),
    scheduleJson: JSON.stringify(contracts.schedule),
    thresholdsJson: JSON.stringify(contracts.thresholds),
  };
}

function mapWorkflowRow(row: {
  createdAt: number;
  createdByUserId: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  description: string | null;
  id: string;
  lastEnabledByUserId: string | null;
  lastRunAt: number | null;
  name: string;
  nextRunAt: number | null;
  organizationId: string;
  status: WorkflowStatus;
  updatedAt: number;
  visibility: WorkflowVisibility;
}) {
  return {
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId,
    currentVersionId: row.currentVersionId,
    currentVersionNumber: row.currentVersionNumber,
    description: row.description,
    id: row.id,
    lastEnabledByUserId: row.lastEnabledByUserId,
    lastRunAt: row.lastRunAt,
    name: row.name,
    nextRunAt: row.nextRunAt,
    organizationId: row.organizationId,
    status: row.status,
    updatedAt: row.updatedAt,
    visibility: row.visibility,
  } satisfies WorkflowRecord;
}

function mapVersionSummaryRow(row: {
  createdAt: number;
  createdByUserId: string | null;
  id: string;
  versionNumber: number;
}) {
  return {
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId,
    id: row.id,
    versionNumber: row.versionNumber,
  } satisfies WorkflowVersionSummary;
}

function mapVersionRecord(row: {
  createdAt: number;
  createdByUserId: string | null;
  deliveryJson: string;
  executionIdentityJson: string;
  id: string;
  inputBindingsJson: string;
  inputContractJson: string;
  outputsJson: string;
  provenanceJson: string;
  recipeJson: string;
  scheduleJson: string;
  thresholdsJson: string;
  versionNumber: number;
}) {
  return {
    contracts: parseWorkflowVersionContracts({
      deliveryJson: row.deliveryJson,
      executionIdentityJson: row.executionIdentityJson,
      inputBindingsJson: row.inputBindingsJson,
      inputContractJson: row.inputContractJson,
      outputsJson: row.outputsJson,
      provenanceJson: row.provenanceJson,
      recipeJson: row.recipeJson,
      scheduleJson: row.scheduleJson,
      thresholdsJson: row.thresholdsJson,
    }),
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId,
    id: row.id,
    versionNumber: row.versionNumber,
  } satisfies WorkflowVersionRecord;
}

async function getNextWorkflowVersionNumber(workflowId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      maxVersion: sql<number>`coalesce(max(${workflowVersions.versionNumber}), 0)`,
    })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId))
    .limit(1);

  return Number(rows[0]?.maxVersion ?? 0) + 1;
}

function getManualOnlySchedule(): WorkflowScheduleV1 {
  return {
    kind: "manual_only",
    schema_version: 1,
  };
}

function estimateScheduledRunsPerWindow(schedule: WorkflowScheduleV1) {
  if (schedule.kind !== "recurring") {
    return 0;
  }

  if (schedule.cadence.kind === "weekly") {
    return 5;
  }

  return 1;
}

type WorkflowPlanUsage = {
  activeWorkflowCount: number;
  contributionsByWorkflowId: Map<string, { active: number; scheduledRunsPerWindow: number }>;
  scheduledRunsPerWindowEstimate: number;
};

async function getOrganizationWorkflowPlanUsage(organizationId: string): Promise<WorkflowPlanUsage> {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      id: workflows.id,
      scheduleJson: workflowVersions.scheduleJson,
      status: workflows.status,
    })
    .from(workflows)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .where(eq(workflows.organizationId, organizationId));

  let activeWorkflowCount = 0;
  let scheduledRunsPerWindowEstimate = 0;
  const contributionsByWorkflowId = new Map<string, { active: number; scheduledRunsPerWindow: number }>();

  for (const row of rows) {
    if (row.status !== "active") {
      continue;
    }

    let schedule = getManualOnlySchedule();

    try {
      schedule = row.scheduleJson
        ? parseWorkflowScheduleJson(row.scheduleJson)
        : getManualOnlySchedule();
    } catch {
      schedule = getManualOnlySchedule();
    }

    const scheduledRunsPerWindow = estimateScheduledRunsPerWindow(schedule);

    activeWorkflowCount += 1;
    scheduledRunsPerWindowEstimate += scheduledRunsPerWindow;
    contributionsByWorkflowId.set(row.id, {
      active: 1,
      scheduledRunsPerWindow,
    });
  }

  return {
    activeWorkflowCount,
    contributionsByWorkflowId,
    scheduledRunsPerWindowEstimate,
  };
}

async function enforceWorkflowPlanLimits(input: {
  existingWorkflowId?: string | null;
  nextSchedule: WorkflowScheduleV1;
  nextStatus: WorkflowStatus;
  organizationId: string;
}) {
  const [plan, usage] = await Promise.all([
    getWorkspacePlanSummary(input.organizationId),
    getOrganizationWorkflowPlanUsage(input.organizationId),
  ]);
  const limits = plan.workflowEntitlements;
  const existingContribution = input.existingWorkflowId
    ? usage.contributionsByWorkflowId.get(input.existingWorkflowId) ?? {
        active: 0,
        scheduledRunsPerWindow: 0,
      }
    : {
        active: 0,
        scheduledRunsPerWindow: 0,
      };
  const nextActiveContribution = input.nextStatus === "active" ? 1 : 0;
  const nextScheduledContribution =
    input.nextStatus === "active" ? estimateScheduledRunsPerWindow(input.nextSchedule) : 0;
  const projectedActiveWorkflowCount =
    usage.activeWorkflowCount - existingContribution.active + nextActiveContribution;
  const projectedScheduledRunsPerWindow =
    usage.scheduledRunsPerWindowEstimate -
    existingContribution.scheduledRunsPerWindow +
    nextScheduledContribution;

  if (projectedActiveWorkflowCount > limits.maxActiveWorkflows) {
    throw new Error(
      `This workspace plan allows at most ${limits.maxActiveWorkflows} active workflows. Archive or pause a workflow before activating another.`,
    );
  }

  if (projectedScheduledRunsPerWindow > limits.maxScheduledRunsPerWindow) {
    throw new Error(
      `This workspace plan allows at most ${limits.maxScheduledRunsPerWindow} scheduled runs per window (estimated). Reduce recurring workflows before activating this schedule.`,
    );
  }
}

async function loadWorkflowScheduleForVersion(input: {
  currentVersionId: string | null;
  organizationId: string;
  workflowId: string;
}) {
  if (!input.currentVersionId) {
    return getManualOnlySchedule();
  }

  const db = await getAppDatabase();
  const row = await db.query.workflowVersions.findFirst({
    where: and(
      eq(workflowVersions.id, input.currentVersionId),
      eq(workflowVersions.organizationId, input.organizationId),
      eq(workflowVersions.workflowId, input.workflowId),
    ),
  });

  if (!row) {
    return getManualOnlySchedule();
  }

  try {
    return parseWorkflowScheduleJson(row.scheduleJson);
  } catch {
    return getManualOnlySchedule();
  }
}

export async function listWorkflowsForOrganization(organizationId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      createdAt: workflows.createdAt,
      createdByUserId: workflows.createdByUserId,
      currentVersionId: workflows.currentVersionId,
      currentVersionNumber: workflowVersions.versionNumber,
      description: workflows.description,
      id: workflows.id,
      lastEnabledByUserId: workflows.lastEnabledByUserId,
      lastRunAt: workflows.lastRunAt,
      name: workflows.name,
      nextRunAt: workflows.nextRunAt,
      organizationId: workflows.organizationId,
      status: workflows.status,
      updatedAt: workflows.updatedAt,
      visibility: workflows.visibility,
    })
    .from(workflows)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .where(eq(workflows.organizationId, organizationId))
    .orderBy(desc(workflows.updatedAt), desc(workflows.createdAt));

  return {
    workflows: rows.map(mapWorkflowRow),
  };
}

export async function getWorkflowDetail(input: {
  organizationId: string;
  workflowId: string;
}) {
  const db = await getAppDatabase();
  const workflowRows = await db
    .select({
      createdAt: workflows.createdAt,
      createdByUserId: workflows.createdByUserId,
      currentVersionId: workflows.currentVersionId,
      currentVersionNumber: workflowVersions.versionNumber,
      description: workflows.description,
      id: workflows.id,
      lastEnabledByUserId: workflows.lastEnabledByUserId,
      lastRunAt: workflows.lastRunAt,
      name: workflows.name,
      nextRunAt: workflows.nextRunAt,
      organizationId: workflows.organizationId,
      status: workflows.status,
      updatedAt: workflows.updatedAt,
      visibility: workflows.visibility,
    })
    .from(workflows)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .where(
      and(
        eq(workflows.organizationId, input.organizationId),
        eq(workflows.id, input.workflowId),
      ),
    )
    .limit(1);
  const workflowRow = workflowRows[0];

  if (!workflowRow) {
    return null;
  }

  const versionRows = await db
    .select({
      createdAt: workflowVersions.createdAt,
      createdByUserId: workflowVersions.createdByUserId,
      deliveryJson: workflowVersions.deliveryJson,
      executionIdentityJson: workflowVersions.executionIdentityJson,
      id: workflowVersions.id,
      inputBindingsJson: workflowVersions.inputBindingsJson,
      inputContractJson: workflowVersions.inputContractJson,
      outputsJson: workflowVersions.outputsJson,
      provenanceJson: workflowVersions.provenanceJson,
      recipeJson: workflowVersions.recipeJson,
      scheduleJson: workflowVersions.scheduleJson,
      thresholdsJson: workflowVersions.thresholdsJson,
      versionNumber: workflowVersions.versionNumber,
    })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.organizationId, input.organizationId),
        eq(workflowVersions.workflowId, input.workflowId),
      ),
    )
    .orderBy(desc(workflowVersions.versionNumber), desc(workflowVersions.createdAt));

  const currentVersion =
    workflowRow.currentVersionId === null
      ? null
      : versionRows.find((version) => version.id === workflowRow.currentVersionId) ?? null;

  return {
    currentVersion: currentVersion ? mapVersionRecord(currentVersion) : null,
    versions: versionRows.map(mapVersionSummaryRow),
    workflow: mapWorkflowRow(workflowRow),
  } satisfies WorkflowDetailRecord;
}

export async function createWorkflow(input: {
  createdByUserId: string;
  description?: string | null;
  name: string;
  organizationId: string;
  status?: WorkflowStatus;
  version?: WorkflowVersionInput;
  visibility?: WorkflowVisibility;
}) {
  const now = Date.now();
  const workflowId = randomUUID();
  const workflowVersionId = randomUUID();
  const normalizedName = normalizeName(input.name);
  const normalizedDescription = normalizeDescription(input.description);
  const contracts = normalizeVersionInput(input.version, input.createdByUserId);
  const persistedContracts = toPersistedWorkflowContracts(contracts);
  const nextStatus = input.status ?? "draft";
  const nextRunAt =
    nextStatus === "active" ? computeNextScheduledRunAt(contracts.schedule, now) : null;

  await enforceWorkflowPlanLimits({
    nextSchedule: contracts.schedule,
    nextStatus,
    organizationId: input.organizationId,
  });

  const db = await getAppDatabase();

  await db.transaction((transaction) => {
    transaction.insert(workflows).values({
      createdAt: now,
      createdByUserId: input.createdByUserId,
      currentVersionId: workflowVersionId,
      description: normalizedDescription,
      id: workflowId,
      lastEnabledByUserId: input.status === "active" ? input.createdByUserId : null,
      lastRunAt: null,
      name: normalizedName,
      nextRunAt,
      organizationId: input.organizationId,
      status: nextStatus,
      updatedAt: now,
      visibility: input.visibility ?? "organization",
    }).run();

    transaction.insert(workflowVersions).values({
      createdAt: now,
      createdByUserId: input.createdByUserId,
      deliveryJson: persistedContracts.deliveryJson,
      executionIdentityJson: persistedContracts.executionIdentityJson,
      id: workflowVersionId,
      inputBindingsJson: persistedContracts.inputBindingsJson,
      inputContractJson: persistedContracts.inputContractJson,
      organizationId: input.organizationId,
      outputsJson: persistedContracts.outputsJson,
      provenanceJson: persistedContracts.provenanceJson,
      recipeJson: persistedContracts.recipeJson,
      scheduleJson: persistedContracts.scheduleJson,
      thresholdsJson: persistedContracts.thresholdsJson,
      versionNumber: 1,
      workflowId,
    }).run();
  });

  return getWorkflowDetail({
    organizationId: input.organizationId,
    workflowId,
  });
}

export async function updateWorkflow(input: {
  organizationId: string;
  updatedByUserId: string;
  workflowId: string;
  patch: {
    description?: string | null;
    name?: string;
    status?: WorkflowStatus;
    version?: WorkflowVersionInput;
    visibility?: WorkflowVisibility;
  };
}) {
  const db = await getAppDatabase();
  const existing = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, input.workflowId),
      eq(workflows.organizationId, input.organizationId),
    ),
  });

  if (!existing) {
    throw new Error("Workflow not found.");
  }

  const hasMetadataPatch =
    typeof input.patch.name !== "undefined" ||
    typeof input.patch.description !== "undefined" ||
    typeof input.patch.visibility !== "undefined" ||
    typeof input.patch.status !== "undefined";
  const hasVersionPatch = typeof input.patch.version !== "undefined";

  if (!hasMetadataPatch && !hasVersionPatch) {
    throw new Error("No workflow changes were provided.");
  }

  const now = Date.now();
  const nextStatus = input.patch.status ?? existing.status;
  let nextCurrentVersionId = existing.currentVersionId;
  const existingSchedule = await loadWorkflowScheduleForVersion({
    currentVersionId: existing.currentVersionId,
    organizationId: input.organizationId,
    workflowId: existing.id,
  });
  let nextSchedule = existingSchedule;
  let nextContracts: WorkflowVersionContractsV1 | null = null;

  if (hasVersionPatch) {
    nextContracts = normalizeVersionInput(input.patch.version, input.updatedByUserId);
    nextSchedule = nextContracts.schedule;
  }

  await enforceWorkflowPlanLimits({
    existingWorkflowId: existing.id,
    nextSchedule,
    nextStatus,
    organizationId: input.organizationId,
  });

  const scheduleChanged = JSON.stringify(nextSchedule) !== JSON.stringify(existingSchedule);
  const nextRunAt =
    nextStatus !== "active"
      ? null
      : existing.status !== "active" || scheduleChanged || existing.nextRunAt === null
        ? computeNextScheduledRunAt(nextSchedule, now)
        : existing.nextRunAt;

  if (hasVersionPatch && nextContracts) {
    const persistedContracts = toPersistedWorkflowContracts(nextContracts);
    const versionId = randomUUID();
    const versionNumber = await getNextWorkflowVersionNumber(existing.id);

    await db.insert(workflowVersions).values({
      createdAt: now,
      createdByUserId: input.updatedByUserId,
      deliveryJson: persistedContracts.deliveryJson,
      executionIdentityJson: persistedContracts.executionIdentityJson,
      id: versionId,
      inputBindingsJson: persistedContracts.inputBindingsJson,
      inputContractJson: persistedContracts.inputContractJson,
      organizationId: input.organizationId,
      outputsJson: persistedContracts.outputsJson,
      provenanceJson: persistedContracts.provenanceJson,
      recipeJson: persistedContracts.recipeJson,
      scheduleJson: persistedContracts.scheduleJson,
      thresholdsJson: persistedContracts.thresholdsJson,
      versionNumber,
      workflowId: existing.id,
    });

    nextCurrentVersionId = versionId;
  }

  const nextName =
    typeof input.patch.name === "string" ? normalizeName(input.patch.name) : existing.name;
  const nextDescription =
    typeof input.patch.description === "undefined"
      ? existing.description
      : normalizeDescription(input.patch.description);

  await db
    .update(workflows)
    .set({
      currentVersionId: nextCurrentVersionId,
      description: nextDescription,
      lastEnabledByUserId:
        input.patch.status === "active"
          ? input.updatedByUserId
          : existing.lastEnabledByUserId,
      name: nextName,
      nextRunAt,
      status: nextStatus,
      updatedAt: now,
      visibility: input.patch.visibility ?? existing.visibility,
    })
    .where(eq(workflows.id, existing.id));

  return getWorkflowDetail({
    organizationId: input.organizationId,
    workflowId: existing.id,
  });
}
