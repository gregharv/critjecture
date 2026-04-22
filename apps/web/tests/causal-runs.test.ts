import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { getAppDatabase } from "@/lib/app-db";
import { createGroundedCausalAnswer } from "@/lib/causal-answers";
import { runCausalIntake } from "@/lib/causal-intake";
import { approveCausalDagVersion, createCausalDagVersion, ensureStudyDag } from "@/lib/causal-dags";
import { createAndExecuteCausalRun, getCausalRunDetail, listCausalRunsForStudy } from "@/lib/causal-runs";
import {
  causalAnswerPackages,
  causalAnswers,
  causalEstimates,
  causalEstimands,
  causalIdentifications,
  causalRefutations,
  causalRuns,
  computeRuns,
  datasetVersionColumns,
  datasetVersions,
  datasets,
  runArtifacts,
} from "@/lib/app-schema";
import { upsertStudyDatasetBinding } from "@/lib/study-dataset-bindings";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

async function seedDatasetFixture(input: { datasetPath: string; organizationId: string }) {
  const db = await getAppDatabase();
  const now = Date.now();

  await mkdir(path.dirname(input.datasetPath), { recursive: true });
  await writeFile(
    input.datasetPath,
    [
      "discount_rate,conversion_rate,seasonality",
      "0,10,1",
      "1,12,1",
      "2,14,2",
      "3,16,2",
      "4,18,3",
      "5,20,3",
    ].join("\n"),
    "utf8",
  );

  await db.insert(datasets).values({
    id: "dataset-1",
    organizationId: input.organizationId,
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
    activeVersionId: "dataset-version-1",
    metadataJson: "{}",
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(datasetVersions).values({
    id: "dataset-version-1",
    datasetId: "dataset-1",
    organizationId: input.organizationId,
    versionNumber: 1,
    sourceVersionToken: "v1",
    sourceModifiedAt: now,
    contentHash: "hash-1",
    schemaHash: "schema-1",
    rowCount: 6,
    byteSize: 256,
    materializedPath: input.datasetPath,
    ingestionStatus: "ready",
    profileStatus: "ready",
    ingestionError: null,
    profileError: null,
    indexedAt: now,
    metadataJson: "{}",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(datasetVersionColumns).values([
    {
      id: "column-treatment",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
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
      id: "column-outcome",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
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
    {
      id: "column-conounder",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
      columnName: "seasonality",
      displayName: "Seasonality",
      columnOrder: 2,
      physicalType: "float",
      semanticType: "numeric",
      nullable: false,
      isIndexedCandidate: false,
      isTreatmentCandidate: false,
      isOutcomeCandidate: false,
      description: "Observed seasonality",
      metadataJson: "{}",
      createdAt: now,
    },
  ]);
}

async function prepareApprovedStudy(input: {
  datasetPath: string;
  includeLatentConfounder?: boolean;
  organizationId: string;
  userId: string;
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUserByEmail>>>;
}) {
  const intake = await runCausalIntake({
    message: "Did the pricing change affect conversion?",
    user: input.user,
  });
  expect(intake.decision).toBe("open_causal_study");
  if (intake.decision !== "open_causal_study") {
    throw new Error("Expected causal study creation.");
  }

  await seedDatasetFixture({
    datasetPath: input.datasetPath,
    organizationId: input.organizationId,
  });

  await upsertStudyDatasetBinding({
    bindingRole: "primary",
    createdByUserId: input.userId,
    datasetId: "dataset-1",
    datasetVersionId: "dataset-version-1",
    organizationId: input.organizationId,
    studyId: intake.studyId,
  });

  const dag = await ensureStudyDag({
    createdByUserId: input.userId,
    organizationId: input.organizationId,
    studyId: intake.studyId,
    title: "Execution DAG",
  });

  const version = await createCausalDagVersion({
    createdByUserId: input.userId,
    dagId: dag.id,
    draft: {
      assumptions: [],
      dataRequirements: input.includeLatentConfounder
        ? [
            {
              variableLabel: "Market demand",
              reasonNeeded: "Needed to resolve the missing confounder.",
              relatedNodeKey: "market_demand",
              status: "missing",
              suggestedSource: "Finance export",
            },
          ]
        : [],
      description: "Execution-ready DAG",
      edges: input.includeLatentConfounder
        ? [
            { sourceNodeKey: "discount_rate", targetNodeKey: "conversion_rate" },
            { sourceNodeKey: "market_demand", targetNodeKey: "discount_rate" },
            { sourceNodeKey: "market_demand", targetNodeKey: "conversion_rate" },
          ]
        : [
            { sourceNodeKey: "discount_rate", targetNodeKey: "conversion_rate" },
            { sourceNodeKey: "seasonality", targetNodeKey: "discount_rate" },
            { sourceNodeKey: "seasonality", targetNodeKey: "conversion_rate" },
          ],
      layoutJson: "{}",
      nodes: input.includeLatentConfounder
        ? [
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
            {
              datasetColumnId: null,
              label: "Market demand",
              nodeKey: "market_demand",
              nodeType: "latent",
              observedStatus: "unobserved",
              sourceType: "user",
            },
          ]
        : [
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
            {
              datasetColumnId: "column-conounder",
              label: "Seasonality",
              nodeKey: "seasonality",
              nodeType: "confounder",
              observedStatus: "observed",
              sourceType: "dataset",
            },
          ],
      primaryDatasetVersionId: "dataset-version-1",
      title: "Execution DAG",
    },
    organizationId: input.organizationId,
  });

  await approveCausalDagVersion({
    approvedByUserId: input.userId,
    dagId: dag.id,
    dagVersionId: version.dagVersionId,
    organizationId: input.organizationId,
  });

  return intake.studyId;
}

describe("causal runs", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("creates an identified causal run with estimands, estimates, refutations, compute runs, and an answer package", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "identified.csv"),
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const result = await createAndExecuteCausalRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      expect(result.run.status).toBe("completed");
      expect(result.identification?.identified).toBe(true);
      expect(result.estimands).toHaveLength(1);
      expect(result.estimates.length).toBeGreaterThanOrEqual(1);
      expect(result.refutations.length).toBeGreaterThanOrEqual(3);
      expect(result.computeRuns.length).toBeGreaterThanOrEqual(5);
      expect(result.answerPackage).not.toBeNull();

      const db = await getAppDatabase();
      const runRows = await db.select().from(causalRuns).where(eq(causalRuns.id, result.run.id));
      const identificationRows = await db
        .select()
        .from(causalIdentifications)
        .where(eq(causalIdentifications.runId, result.run.id));
      const estimateRows = await db
        .select()
        .from(causalEstimates)
        .where(eq(causalEstimates.runId, result.run.id));
      const packageRows = await db
        .select()
        .from(causalAnswerPackages)
        .where(eq(causalAnswerPackages.runId, result.run.id));
      const artifactRows = await db
        .select()
        .from(runArtifacts)
        .where(eq(runArtifacts.runId, result.run.id));

      expect(runRows[0]?.primaryDatasetVersionId).toBe("dataset-version-1");
      expect(runRows[0]?.treatmentNodeKey).toBe("discount_rate");
      expect(runRows[0]?.outcomeNodeKey).toBe("conversion_rate");
      expect(identificationRows[0]?.identified).toBe(true);
      expect(estimateRows[0]?.estimateValue).not.toBeNull();
      expect(packageRows).toHaveLength(1);
      expect(packageRows[0]?.packageJson).toContain("CORROBORATED CAUSAL CONJECTURE");
      expect(artifactRows.length).toBeGreaterThanOrEqual(3);
    } finally {
      await environment.cleanup();
    }
  });

  it("persists honest not_identifiable runs without estimates when unobserved confounding blocks identification", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "not-identifiable.csv"),
        includeLatentConfounder: true,
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const result = await createAndExecuteCausalRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      expect(result.run.status).toBe("not_identifiable");
      expect(result.identification?.identified).toBe(false);
      expect(result.estimates).toHaveLength(0);
      expect(result.answerPackage?.packageJson).toContain("not identified");
      expect(result.answerPackage?.packageJson).toContain("SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA");

      const db = await getAppDatabase();
      const estimateRows = await db
        .select()
        .from(causalEstimates)
        .where(eq(causalEstimates.runId, result.run.id));
      const refutationRows = await db
        .select()
        .from(causalRefutations)
        .where(eq(causalRefutations.runId, result.run.id));

      expect(estimateRows).toHaveLength(0);
      expect(refutationRows).toHaveLength(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("requires approval for the exact DAG version before creating a run", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      const intake = await runCausalIntake({
        message: "Did discount rate affect conversion?",
        user: user!,
      });
      expect(intake.decision).toBe("open_causal_study");
      if (intake.decision !== "open_causal_study") {
        throw new Error("Expected causal study creation.");
      }

      await seedDatasetFixture({
        datasetPath: path.join(environment.rootDir, "datasets", "unapproved.csv"),
        organizationId: user!.organizationId,
      });
      await upsertStudyDatasetBinding({
        bindingRole: "primary",
        createdByUserId: user!.id,
        datasetId: "dataset-1",
        datasetVersionId: "dataset-version-1",
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });
      const dag = await ensureStudyDag({
        createdByUserId: user!.id,
        organizationId: user!.organizationId,
        studyId: intake.studyId,
        title: "Unapproved DAG",
      });
      await createCausalDagVersion({
        createdByUserId: user!.id,
        dagId: dag.id,
        draft: {
          assumptions: [],
          dataRequirements: [],
          description: "Unapproved DAG",
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
          title: "Unapproved DAG",
        },
        organizationId: user!.organizationId,
      });

      await expect(
        createAndExecuteCausalRun({
          runUser: {
            id: user!.id,
            organizationId: user!.organizationId,
            organizationSlug: user!.organizationSlug,
          },
          studyId: intake.studyId,
        }),
      ).rejects.toThrow(/approval/i);
    } finally {
      await environment.cleanup();
    }
  });

  it("generates grounded answers only from stored answer packages and records answer history", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "answers.csv"),
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const created = await createAndExecuteCausalRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      const db = await getAppDatabase();
      const packages = await db
        .select()
        .from(causalAnswerPackages)
        .where(eq(causalAnswerPackages.runId, created.run.id));
      expect(packages).toHaveLength(1);

      const parsedPackage = JSON.parse(packages[0]!.packageJson) as Record<string, unknown>;
      parsedPackage.limitations = ["Package-only limitation sentinel."];
      await db
        .update(causalAnswerPackages)
        .set({ packageJson: JSON.stringify(parsedPackage) })
        .where(eq(causalAnswerPackages.id, packages[0]!.id));

      const answer = await createGroundedCausalAnswer({
        organizationId: user!.organizationId,
        runId: created.run.id,
      });
      expect(answer?.answerText).toContain("Package-only limitation sentinel.");
      expect(answer?.answerText).toContain("stored causal answer package only");
      expect(answer?.answerText).toContain("Claim label:");

      await createGroundedCausalAnswer({
        organizationId: user!.organizationId,
        runId: created.run.id,
      });

      const answerRows = await db.select().from(causalAnswers).where(eq(causalAnswers.runId, created.run.id));
      expect(answerRows).toHaveLength(2);
    } finally {
      await environment.cleanup();
    }
  });

  it("renders not-identifiable grounded answers honestly", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "not-identifiable-answer.csv"),
        includeLatentConfounder: true,
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const created = await createAndExecuteCausalRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      const answer = await createGroundedCausalAnswer({
        organizationId: user!.organizationId,
        runId: created.run.id,
      });

      expect(answer?.answerText).toContain("not identified");
      expect(answer?.answerText).toContain("unobserved");
      expect(answer?.answerText).toContain("SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA");
    } finally {
      await environment.cleanup();
    }
  });

  it("returns run summaries with comparison-ready metrics", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "summary.csv"),
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const created = await createAndExecuteCausalRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      await createGroundedCausalAnswer({
        organizationId: user!.organizationId,
        runId: created.run.id,
      });

      const summaries = await listCausalRunsForStudy({
        organizationId: user!.organizationId,
        studyId,
      });

      expect(summaries[0]?.id).toBe(created.run.id);
      expect(summaries[0]?.identified).toBe(true);
      expect(summaries[0]?.identificationMethod).toBeTruthy();
      expect(summaries[0]?.primaryEstimateValue).not.toBeNull();
      expect(summaries[0]?.primaryEstimateIntervalLow).not.toBeNull();
      expect(summaries[0]?.primaryEstimateIntervalHigh).not.toBeNull();
      expect(summaries[0]?.adjustmentSet).toContain("seasonality");
      expect(summaries[0]?.estimandLabels[0]).toContain("Discount rate");
      expect(summaries[0]?.refuterNames.length).toBeGreaterThanOrEqual(3);
      expect(summaries[0]?.blockingReasons).toHaveLength(0);
      expect(summaries[0]?.refutationCount).toBeGreaterThanOrEqual(3);
      expect(summaries[0]?.answerCount).toBeGreaterThanOrEqual(1);
      expect(summaries[0]?.artifactCount).toBeGreaterThanOrEqual(3);
    } finally {
      await environment.cleanup();
    }
  });

  it("returns run detail with persisted package and compute run history", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "detail.csv"),
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const created = await createAndExecuteCausalRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      const detail = await getCausalRunDetail({
        organizationId: user!.organizationId,
        runId: created.run.id,
      });

      expect(detail.run.id).toBe(created.run.id);
      expect(detail.computeRuns.length).toBeGreaterThanOrEqual(5);
      expect(detail.answerPackage).not.toBeNull();
    } finally {
      await environment.cleanup();
    }
  });
});
