import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { runCausalIntake } from "@/lib/causal-intake";
import {
  datasetVersionColumns,
  datasetVersions,
  datasets,
  studyDatasetBindings,
} from "@/lib/app-schema";
import {
  assertStudyHasPinnedPrimaryDataset,
  getPrimaryStudyDatasetSeedContract,
  getStudyDatasetBindingReadiness,
  upsertStudyDatasetBinding,
} from "@/lib/study-dataset-bindings";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

async function seedDatasetFixture(organizationId: string) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db.insert(datasets).values([
    {
      id: "dataset-1",
      organizationId,
      connectionId: null,
      datasetKey: "conversions",
      displayName: "Conversions",
      description: "Conversion events",
      accessScope: "admin",
      dataKind: "table",
      grainDescription: "user-day",
      timeColumnName: "event_date",
      entityIdColumnName: "user_id",
      status: "active",
      activeVersionId: "dataset-version-2",
      metadataJson: "{}",
      createdByUserId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "dataset-2",
      organizationId,
      connectionId: null,
      datasetKey: "pricing",
      displayName: "Pricing experiments",
      description: "Pricing tests",
      accessScope: "admin",
      dataKind: "table",
      grainDescription: "experiment-user",
      timeColumnName: "event_date",
      entityIdColumnName: "user_id",
      status: "active",
      activeVersionId: "dataset-version-3",
      metadataJson: "{}",
      createdByUserId: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(datasetVersions).values([
    {
      id: "dataset-version-1",
      datasetId: "dataset-1",
      organizationId,
      versionNumber: 1,
      sourceVersionToken: "v1",
      sourceModifiedAt: now,
      contentHash: "hash-1",
      schemaHash: "schema-1",
      rowCount: 100,
      byteSize: 1000,
      materializedPath: "/tmp/conversions-v1.parquet",
      ingestionStatus: "ready",
      profileStatus: "ready",
      ingestionError: null,
      profileError: null,
      indexedAt: now,
      metadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "dataset-version-2",
      datasetId: "dataset-1",
      organizationId,
      versionNumber: 2,
      sourceVersionToken: "v2",
      sourceModifiedAt: now,
      contentHash: "hash-2",
      schemaHash: "schema-2",
      rowCount: 120,
      byteSize: 1200,
      materializedPath: "/tmp/conversions-v2.parquet",
      ingestionStatus: "ready",
      profileStatus: "ready",
      ingestionError: null,
      profileError: null,
      indexedAt: now,
      metadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "dataset-version-3",
      datasetId: "dataset-2",
      organizationId,
      versionNumber: 1,
      sourceVersionToken: "v1",
      sourceModifiedAt: now,
      contentHash: "hash-3",
      schemaHash: "schema-3",
      rowCount: 80,
      byteSize: 800,
      materializedPath: "/tmp/pricing-v1.parquet",
      ingestionStatus: "ready",
      profileStatus: "ready",
      ingestionError: null,
      profileError: null,
      indexedAt: now,
      metadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(datasetVersionColumns).values([
    {
      id: "column-1",
      datasetVersionId: "dataset-version-2",
      organizationId,
      columnName: "discount_rate",
      displayName: "Discount rate",
      columnOrder: 0,
      physicalType: "float",
      semanticType: "treatment_candidate",
      nullable: false,
      isIndexedCandidate: false,
      isTreatmentCandidate: true,
      isOutcomeCandidate: false,
      description: "Applied discount rate",
      metadataJson: "{}",
      createdAt: now,
    },
    {
      id: "column-2",
      datasetVersionId: "dataset-version-2",
      organizationId,
      columnName: "conversion_rate",
      displayName: "Conversion rate",
      columnOrder: 1,
      physicalType: "float",
      semanticType: "outcome_candidate",
      nullable: false,
      isIndexedCandidate: false,
      isTreatmentCandidate: false,
      isOutcomeCandidate: true,
      description: "Observed conversion rate",
      metadataJson: "{}",
      createdAt: now,
    },
  ]);
}

describe("study dataset bindings", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("pins exactly one active primary dataset version and deactivates the previous primary binding", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const intake = await runCausalIntake({
        message: "Why did conversion drop after the pricing change?",
        user: user!,
      });
      expect(intake.decision).toBe("open_causal_study");
      if (intake.decision !== "open_causal_study") {
        throw new Error("Expected causal study creation.");
      }

      await seedDatasetFixture(user!.organizationId);

      await upsertStudyDatasetBinding({
        bindingRole: "primary",
        createdByUserId: user!.id,
        datasetId: "dataset-1",
        datasetVersionId: "dataset-version-1",
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      await upsertStudyDatasetBinding({
        bindingRole: "primary",
        createdByUserId: user!.id,
        datasetId: "dataset-2",
        datasetVersionId: "dataset-version-3",
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      const db = await getAppDatabase();
      const bindings = await db
        .select()
        .from(studyDatasetBindings)
        .where(eq(studyDatasetBindings.studyId, intake.studyId));

      const activePrimaryBindings = bindings.filter(
        (binding) => binding.bindingRole === "primary" && binding.isActive,
      );

      expect(activePrimaryBindings).toHaveLength(1);
      expect(activePrimaryBindings[0]?.datasetId).toBe("dataset-2");
    } finally {
      await environment.cleanup();
    }
  });

  it("returns a schema-backed seed contract from the pinned primary dataset version", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const intake = await runCausalIntake({
        message: "What happens if we increase discount rate by five percent?",
        user: user!,
      });
      expect(intake.decision).toBe("open_causal_study");
      if (intake.decision !== "open_causal_study") {
        throw new Error("Expected causal study creation.");
      }

      await seedDatasetFixture(user!.organizationId);
      await upsertStudyDatasetBinding({
        bindingRole: "primary",
        createdByUserId: user!.id,
        datasetId: "dataset-1",
        datasetVersionId: "dataset-version-2",
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      const seedContract = await getPrimaryStudyDatasetSeedContract({
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      expect(seedContract).not.toBeNull();
      expect(seedContract?.dataset.id).toBe("dataset-1");
      expect(seedContract?.datasetVersion.id).toBe("dataset-version-2");
      expect(seedContract?.columns.map((column) => column.columnName)).toEqual([
        "discount_rate",
        "conversion_rate",
      ]);
    } finally {
      await environment.cleanup();
    }
  });

  it("blocks DAG approval and run creation until one active primary dataset version is pinned", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const intake = await runCausalIntake({
        message: "Why did activation change?",
        user: user!,
      });
      expect(intake.decision).toBe("open_causal_study");
      if (intake.decision !== "open_causal_study") {
        throw new Error("Expected causal study creation.");
      }

      const initialReadiness = await getStudyDatasetBindingReadiness({
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      expect(initialReadiness.canApproveDag).toBe(false);
      expect(initialReadiness.canCreateRun).toBe(false);
      expect(initialReadiness.reasons[0]).toMatch(/Exactly one active primary dataset binding is required/i);

      await seedDatasetFixture(user!.organizationId);
      await expect(
        assertStudyHasPinnedPrimaryDataset({
          organizationId: user!.organizationId,
          studyId: intake.studyId,
        }),
      ).rejects.toThrow(/Exactly one active primary dataset binding is required/i);

      await upsertStudyDatasetBinding({
        bindingRole: "primary",
        createdByUserId: user!.id,
        datasetId: "dataset-1",
        datasetVersionId: "dataset-version-2",
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      const ready = await getStudyDatasetBindingReadiness({
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      expect(ready.canApproveDag).toBe(true);
      expect(ready.canCreateRun).toBe(true);

      const primaryBinding = await assertStudyHasPinnedPrimaryDataset({
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });
      expect(primaryBinding.datasetVersion?.id).toBe("dataset-version-2");
    } finally {
      await environment.cleanup();
    }
  });
});
