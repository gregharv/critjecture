import { describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import {
  createCausalDagVersion,
  ensureStudyDag,
} from "@/lib/causal-dags";
import {
  getComparisonStateForStudy,
  recordRecentComparison,
  renameComparisonSnapshot,
  saveComparisonSnapshot,
  togglePinComparisonSnapshot,
} from "@/lib/causal-comparisons";
import { runCausalIntake } from "@/lib/causal-intake";
import {
  causalRuns,
  datasetVersionColumns,
  datasetVersions,
  datasets,
} from "@/lib/app-schema";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

async function seedStudyFixture(input: {
  organizationId: string;
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUserByEmail>>>;
}) {
  const intake = await runCausalIntake({
    message: "Did the pricing change affect conversion rate?",
    user: input.user,
  });

  expect(intake.decision).toBe("open_causal_study");
  if (intake.decision !== "open_causal_study") {
    throw new Error("Expected causal study creation.");
  }

  const db = await getAppDatabase();
  const now = Date.now();

  await db.insert(datasets).values({
    activeVersionId: "dataset-version-1",
    accessScope: "admin",
    connectionId: null,
    createdAt: now,
    createdByUserId: null,
    dataKind: "table",
    datasetKey: "conversions",
    description: "Conversion events",
    displayName: "Conversions",
    entityIdColumnName: "user_id",
    grainDescription: "user-day",
    id: "dataset-1",
    metadataJson: "{}",
    organizationId: input.organizationId,
    status: "active",
    timeColumnName: "event_date",
    updatedAt: now,
  });

  await db.insert(datasetVersions).values({
    byteSize: 128,
    contentHash: "dataset-hash-1",
    createdAt: now,
    datasetId: "dataset-1",
    id: "dataset-version-1",
    indexedAt: now,
    ingestionError: null,
    ingestionStatus: "ready",
    materializedPath: "/tmp/conversions.csv",
    metadataJson: "{}",
    organizationId: input.organizationId,
    profileError: null,
    profileStatus: "ready",
    rowCount: 50,
    schemaHash: "schema-hash-1",
    sourceModifiedAt: now,
    sourceVersionToken: "v1",
    updatedAt: now,
    versionNumber: 1,
  });

  await db.insert(datasetVersionColumns).values([
    {
      columnName: "discount_rate",
      columnOrder: 0,
      createdAt: now,
      datasetVersionId: "dataset-version-1",
      description: "Discount rate",
      displayName: "Discount rate",
      id: "column-treatment",
      isIndexedCandidate: false,
      isOutcomeCandidate: false,
      isTreatmentCandidate: true,
      metadataJson: "{}",
      nullable: false,
      organizationId: input.organizationId,
      physicalType: "float",
      semanticType: "treatment_candidate",
    },
    {
      columnName: "conversion_rate",
      columnOrder: 1,
      createdAt: now,
      datasetVersionId: "dataset-version-1",
      description: "Conversion rate",
      displayName: "Conversion rate",
      id: "column-outcome",
      isIndexedCandidate: false,
      isOutcomeCandidate: true,
      isTreatmentCandidate: false,
      metadataJson: "{}",
      nullable: false,
      organizationId: input.organizationId,
      physicalType: "float",
      semanticType: "outcome_candidate",
    },
  ]);

  const dag = await ensureStudyDag({
    createdByUserId: input.user.id,
    organizationId: input.organizationId,
    studyId: intake.studyId,
    title: "Comparison DAG",
  });

  const version = await createCausalDagVersion({
    createdByUserId: input.user.id,
    dagId: dag.id,
    draft: {
      assumptions: [],
      dataRequirements: [],
      description: "Comparison-ready DAG",
      edges: [{ sourceNodeKey: "discount_rate", targetNodeKey: "conversion_rate" }],
      layoutJson: "{}",
      nodes: [
        {
          datasetColumnId: "column-treatment",
          label: "Discount rate",
          nodeKey: "discount_rate",
          nodeType: "treatment",
          observedStatus: "observed",
          sourceType: "dataset",
        },
        {
          datasetColumnId: "column-outcome",
          label: "Conversion rate",
          nodeKey: "conversion_rate",
          nodeType: "outcome",
          observedStatus: "observed",
          sourceType: "dataset",
        },
      ],
      primaryDatasetVersionId: "dataset-version-1",
      title: "Comparison DAG",
    },
    organizationId: input.organizationId,
  });

  return {
    dagVersionId: version.dagVersionId,
    datasetVersionId: "dataset-version-1",
    studyId: intake.studyId,
    studyQuestionId: intake.studyQuestionId,
  };
}

async function seedRuns(input: {
  count: number;
  dagVersionId: string;
  datasetVersionId: string;
  organizationId: string;
  requestedByUserId: string;
  studyId: string;
  studyQuestionId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const rows = Array.from({ length: input.count }, (_, index) => ({
    approvalId: null,
    completedAt: now + index,
    createdAt: now + index,
    dagVersionId: input.dagVersionId,
    failureReason: null,
    id: `run-${index + 1}`,
    metadataJson: "{}",
    organizationId: input.organizationId,
    outcomeNodeKey: "conversion_rate",
    primaryDatasetVersionId: input.datasetVersionId,
    requestedByUserId: input.requestedByUserId,
    runnerKind: "pywhy" as const,
    runnerVersion: "test",
    startedAt: now + index,
    status: "completed" as const,
    studyId: input.studyId,
    studyQuestionId: input.studyQuestionId,
    treatmentNodeKey: "discount_rate",
    updatedAt: now + index,
  }));

  await db.insert(causalRuns).values(rows);

  return rows.map((row) => row.id);
}

describe("causal comparisons", () => {
  it("keeps comparison snapshots private to the current user", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      const intern = await getAuthenticatedUserByEmail("intern@example.com");

      expect(owner).not.toBeNull();
      expect(intern).not.toBeNull();
      if (!owner || !intern) {
        throw new Error("Expected seeded users.");
      }

      const study = await seedStudyFixture({
        organizationId: owner.organizationId,
        user: owner,
      });
      const [baseRunId, targetRunId] = await seedRuns({
        count: 2,
        dagVersionId: study.dagVersionId,
        datasetVersionId: study.datasetVersionId,
        organizationId: owner.organizationId,
        requestedByUserId: owner.id,
        studyId: study.studyId,
        studyQuestionId: study.studyQuestionId,
      });

      const ownerState = await saveComparisonSnapshot({
        baseRunId,
        name: "Best identified vs latest",
        organizationId: owner.organizationId,
        studyId: study.studyId,
        targetRunId,
        userId: owner.id,
      });

      const internState = await getComparisonStateForStudy({
        organizationId: owner.organizationId,
        studyId: study.studyId,
        userId: intern.id,
      });

      expect(ownerState.snapshots).toHaveLength(1);
      expect(ownerState.snapshots[0]?.name).toBe("Best identified vs latest");
      expect(internState.snapshots).toEqual([]);
      expect(internState.recentComparisons).toEqual([]);
    } finally {
      await environment.cleanup();
    }
  });

  it("renames and pins snapshots while preserving a single entry per name", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();
      if (!owner) {
        throw new Error("Expected seeded owner.");
      }

      const study = await seedStudyFixture({
        organizationId: owner.organizationId,
        user: owner,
      });
      const [baseRunId, targetRunId, replacementTargetRunId] = await seedRuns({
        count: 3,
        dagVersionId: study.dagVersionId,
        datasetVersionId: study.datasetVersionId,
        organizationId: owner.organizationId,
        requestedByUserId: owner.id,
        studyId: study.studyId,
        studyQuestionId: study.studyQuestionId,
      });

      await saveComparisonSnapshot({
        baseRunId,
        name: "Best vs latest",
        organizationId: owner.organizationId,
        studyId: study.studyId,
        targetRunId,
        userId: owner.id,
      });

      const upserted = await saveComparisonSnapshot({
        baseRunId,
        name: "best vs latest",
        organizationId: owner.organizationId,
        studyId: study.studyId,
        targetRunId: replacementTargetRunId,
        userId: owner.id,
      });

      expect(upserted.snapshots).toHaveLength(1);
      expect(upserted.snapshots[0]?.targetRunId).toBe(replacementTargetRunId);

      const renamed = await renameComparisonSnapshot({
        name: "Pinned baseline",
        organizationId: owner.organizationId,
        snapshotId: upserted.snapshots[0]!.id,
        studyId: study.studyId,
        userId: owner.id,
      });
      const pinned = await togglePinComparisonSnapshot({
        organizationId: owner.organizationId,
        snapshotId: renamed.snapshots[0]!.id,
        studyId: study.studyId,
        userId: owner.id,
      });

      expect(pinned.snapshots).toHaveLength(1);
      expect(pinned.snapshots[0]?.name).toBe("Pinned baseline");
      expect(pinned.snapshots[0]?.pinned).toBe(true);
    } finally {
      await environment.cleanup();
    }
  });

  it("deduplicates and caps recent comparisons to the newest eight pairs", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();
      if (!owner) {
        throw new Error("Expected seeded owner.");
      }

      const study = await seedStudyFixture({
        organizationId: owner.organizationId,
        user: owner,
      });
      const runIds = await seedRuns({
        count: 10,
        dagVersionId: study.dagVersionId,
        datasetVersionId: study.datasetVersionId,
        organizationId: owner.organizationId,
        requestedByUserId: owner.id,
        studyId: study.studyId,
        studyQuestionId: study.studyQuestionId,
      });

      for (const targetRunId of runIds.slice(1)) {
        await recordRecentComparison({
          baseRunId: runIds[0]!,
          organizationId: owner.organizationId,
          studyId: study.studyId,
          targetRunId,
          userId: owner.id,
        });
      }

      const refreshed = await recordRecentComparison({
        baseRunId: runIds[0]!,
        organizationId: owner.organizationId,
        studyId: study.studyId,
        targetRunId: runIds[3]!,
        userId: owner.id,
      });

      expect(refreshed.recentComparisons).toHaveLength(8);
      expect(
        refreshed.recentComparisons.filter((entry) => entry.baseRunId === runIds[0] && entry.targetRunId === runIds[3]),
      ).toHaveLength(1);
      expect(
        refreshed.recentComparisons.some((entry) => entry.baseRunId === runIds[0] && entry.targetRunId === runIds[1]),
      ).toBe(false);
      expect(refreshed.recentComparisons[0]?.targetRunId).toBe(runIds[3]);
    } finally {
      await environment.cleanup();
    }
  });
});
