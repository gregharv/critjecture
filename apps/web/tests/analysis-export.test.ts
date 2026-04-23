import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { createGroundedAnalysisAnswer } from "@/lib/analysis-answers";
import { runAnalysisIntake } from "@/lib/analysis-intake";
import { approveAnalysisDagVersion, createAnalysisDagVersion, ensureAnalysisStudyDag } from "@/lib/analysis-dags";
import { createAndExecuteAnalysisRun } from "@/lib/analysis-runs";
import { exportAnalysisRunComparisonZip, exportAnalysisRunZip } from "@/lib/analysis-export";
import { getAppDatabase } from "@/lib/app-db";
import {
  causalAnswerPackages,
  causalAnswers,
  datasetVersionColumns,
  datasetVersions,
  datasets,
} from "@/lib/app-schema";
import { upsertStudyDatasetBinding } from "@/lib/study-dataset-bindings";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment, resetTestAppState } from "@/tests/helpers/test-environment";
import { eq } from "drizzle-orm";

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
      id: "column-confounder",
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
  organizationId: string;
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUserByEmail>>>;
  userId: string;
}) {
  const intake = await runAnalysisIntake({
    message: "Did the pricing change affect conversion?",
    user: input.user,
  });
  expect(intake.decision).toBe("open_rung2_study");
  if (intake.decision !== "open_rung2_study") {
    throw new Error("Expected analysis study creation.");
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

  const dag = await ensureAnalysisStudyDag({
    createdByUserId: input.userId,
    organizationId: input.organizationId,
    studyId: intake.studyId,
    title: "Export DAG",
  });

  const version = await createAnalysisDagVersion({
    createdByUserId: input.userId,
    dagId: dag.id,
    draft: {
      assumptions: [],
      dataRequirements: [],
      description: "Export-ready DAG",
      edges: [
        { sourceNodeKey: "discount_rate", targetNodeKey: "conversion_rate" },
        { sourceNodeKey: "seasonality", targetNodeKey: "discount_rate" },
        { sourceNodeKey: "seasonality", targetNodeKey: "conversion_rate" },
      ],
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
        {
          datasetColumnId: "column-confounder",
          label: "Seasonality",
          nodeKey: "seasonality",
          nodeType: "confounder",
          observedStatus: "observed",
          sourceType: "dataset",
        },
      ],
      primaryDatasetVersionId: "dataset-version-1",
      title: "Export DAG",
    },
    organizationId: input.organizationId,
  });

  await approveAnalysisDagVersion({
    approvedByUserId: input.userId,
    dagId: dag.id,
    dagVersionId: version.dagVersionId,
    organizationId: input.organizationId,
  });

  return intake.studyId;
}

describe("analysis export bundle", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("exports a workflow-style comparison zip bundle for two analysis runs", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "compare-export.csv"),
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const baseCreated = await createAndExecuteAnalysisRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });
      const targetCreated = await createAndExecuteAnalysisRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      await createGroundedAnalysisAnswer({
        organizationId: user!.organizationId,
        runId: targetCreated.run.id,
      });

      const archive = await exportAnalysisRunComparisonZip({
        baseRunId: baseCreated.run.id,
        organizationId: user!.organizationId,
        studyId,
        targetRunId: targetCreated.run.id,
      });

      expect(archive.archiveFileName).toContain(".zip");
      expect(archive.archiveFileName).toContain("vs");

      const zipText = archive.buffer.toString("utf8");
      expect(zipText).toContain("Analysis run comparison export");
      expect(zipText).toContain("compare/summary.json");
      expect(zipText).toContain("runs/base/run.json");
      expect(zipText).toContain("runs/target/run.json");
      expect(zipText).toContain("runs/base/answers.json");
      expect(zipText).toContain("runs/target/answers.json");
      expect(zipText).toContain("artifacts/base/");
      expect(zipText).toContain("artifacts/target/");
      expect(zipText).toContain(baseCreated.run.id);
      expect(zipText).toContain(targetCreated.run.id);
    } finally {
      await environment.cleanup();
    }
  });

  it("exports a workflow-style zip bundle for analysis runs", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const studyId = await prepareApprovedStudy({
        datasetPath: path.join(environment.rootDir, "datasets", "export.csv"),
        organizationId: user!.organizationId,
        user: user!,
        userId: user!.id,
      });

      const created = await createAndExecuteAnalysisRun({
        runUser: {
          id: user!.id,
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
        },
        studyId,
      });

      const answer = await createGroundedAnalysisAnswer({
        organizationId: user!.organizationId,
        runId: created.run.id,
      });
      expect(answer).not.toBeNull();

      const archive = await exportAnalysisRunZip({
        organizationId: user!.organizationId,
        runId: created.run.id,
      });

      expect(archive.archiveFileName).toContain(".zip");
      expect(archive.archiveFileName).toContain(created.run.id.replaceAll(":", "-"));

      const zipText = archive.buffer.toString("utf8");
      expect(zipText).toContain("README.md");
      expect(zipText).toContain("manifest.json");
      expect(zipText).toContain("run/identification.json");
      expect(zipText).toContain("run/estimands.json");
      expect(zipText).toContain("run/estimates.json");
      expect(zipText).toContain("run/refutations.json");
      expect(zipText).toContain("run/answer-package.json");
      expect(zipText).toContain("run/answers.json");
      expect(zipText).toContain("run/compute-runs.json");
      expect(zipText).toContain("artifacts/");
      expect(zipText).toContain("answer_package.json");
      expect(zipText).toContain("identification.json");
      expect(zipText).toContain("refutation");
      expect(zipText).toContain("Analysis run export");

      const db = await getAppDatabase();
      const packageRows = await db.select().from(causalAnswerPackages).where(eq(causalAnswerPackages.runId, created.run.id));
      const answerRows = await db.select().from(causalAnswers).where(eq(causalAnswers.runId, created.run.id));
      expect(packageRows).toHaveLength(1);
      expect(answerRows).toHaveLength(1);
    } finally {
      await environment.cleanup();
    }
  });
});
