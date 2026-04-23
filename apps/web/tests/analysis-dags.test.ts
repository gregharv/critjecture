import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { runAnalysisIntake } from "@/lib/analysis-intake";
import {
  approveAnalysisDagVersion,
  createAnalysisDagVersion,
  ensureAnalysisStudyDag,
  getAnalysisDagWorkspaceDetail,
} from "@/lib/analysis-dags";
import {
  causalApprovals,
  causalAssumptions,
  causalDagEdges,
  causalDagNodes,
  causalDags,
  causalDagVersions,
  causalDataRequirements,
  causalStudies,
  datasetVersionColumns,
  datasetVersions,
  datasets,
} from "@/lib/app-schema";
import { upsertStudyDatasetBinding } from "@/lib/study-dataset-bindings";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

async function seedDatasetFixture(organizationId: string) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db.insert(datasets).values({
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
  });

  await db.insert(datasetVersions).values({
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
  });

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

describe("analysis DAGs", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("persists graph JSON plus normalized nodes, edges, assumptions, and data requirements", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      const intake = await runAnalysisIntake({
        message: "Did the pricing change affect conversion?",
        user: user!,
      });
      expect(intake.decision).toBe("open_rung2_study");
      if (intake.decision !== "open_rung2_study") {
        throw new Error("Expected analysis study creation.");
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

      const dag = await ensureAnalysisStudyDag({
        createdByUserId: user!.id,
        organizationId: user!.organizationId,
        studyId: intake.studyId,
        title: "Conversion DAG",
      });

      const version = await createAnalysisDagVersion({
        createdByUserId: user!.id,
        dagId: dag.id,
        draft: {
          assumptions: [
            {
              assumptionType: "custom",
              description: "Market demand remains a plausible unobserved confounder.",
              relatedNodeKey: "hidden_demand",
              status: "asserted",
            },
          ],
          dataRequirements: [
            {
              variableLabel: "Competitor pricing",
              reasonNeeded: "Needed to resolve the missing confounder explicitly.",
              relatedNodeKey: "hidden_demand",
              status: "missing",
              suggestedSource: "Finance export",
            },
          ],
          description: "Draft conversion DAG",
          edges: [
            {
              sourceNodeKey: "discount_rate",
              targetNodeKey: "conversion_rate",
              relationshipLabel: "causes",
            },
            {
              sourceNodeKey: "hidden_demand",
              targetNodeKey: "discount_rate",
              relationshipLabel: "causes",
            },
            {
              sourceNodeKey: "hidden_demand",
              targetNodeKey: "conversion_rate",
              relationshipLabel: "causes",
            },
          ],
          layoutJson: "{}",
          nodes: [
            {
              datasetColumnId: "column-1",
              label: "Discount rate",
              nodeKey: "discount_rate",
              nodeType: "treatment",
              observedStatus: "observed",
              sourceType: "dataset",
            },
            {
              datasetColumnId: "column-2",
              label: "Conversion rate",
              nodeKey: "conversion_rate",
              nodeType: "outcome",
              observedStatus: "observed",
              sourceType: "dataset",
            },
            {
              datasetColumnId: null,
              label: "Hidden demand",
              nodeKey: "hidden_demand",
              nodeType: "latent",
              observedStatus: "unobserved",
              sourceType: "user",
            },
          ],
          primaryDatasetVersionId: "dataset-version-2",
          title: "Conversion DAG",
        },
        organizationId: user!.organizationId,
      });

      expect(version.validation.errors).toEqual([]);

      const db = await getAppDatabase();
      const versionRows = await db
        .select()
        .from(causalDagVersions)
        .where(eq(causalDagVersions.id, version.dagVersionId));
      const nodeRows = await db
        .select()
        .from(causalDagNodes)
        .where(eq(causalDagNodes.dagVersionId, version.dagVersionId));
      const edgeRows = await db
        .select()
        .from(causalDagEdges)
        .where(eq(causalDagEdges.dagVersionId, version.dagVersionId));
      const assumptionRows = await db
        .select()
        .from(causalAssumptions)
        .where(eq(causalAssumptions.dagVersionId, version.dagVersionId));
      const requirementRows = await db
        .select()
        .from(causalDataRequirements)
        .where(eq(causalDataRequirements.dagVersionId, version.dagVersionId));

      expect(versionRows).toHaveLength(1);
      expect(versionRows[0]?.graphJson).toContain("hidden_demand");
      expect(versionRows[0]?.primaryDatasetVersionId).toBe("dataset-version-2");
      expect(nodeRows).toHaveLength(3);
      expect(edgeRows).toHaveLength(3);
      expect(assumptionRows).toHaveLength(1);
      expect(requirementRows).toHaveLength(1);
    } finally {
      await environment.cleanup();
    }
  });

  it("blocks approval when the graph contains a cycle", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      const intake = await runAnalysisIntake({
        message: "Did discount rate affect conversion?",
        user: user!,
      });
      expect(intake.decision).toBe("open_rung2_study");
      if (intake.decision !== "open_rung2_study") {
        throw new Error("Expected analysis study creation.");
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

      const dag = await ensureAnalysisStudyDag({
        createdByUserId: user!.id,
        organizationId: user!.organizationId,
        studyId: intake.studyId,
        title: "Cyclic DAG",
      });

      const version = await createAnalysisDagVersion({
        createdByUserId: user!.id,
        dagId: dag.id,
        draft: {
          assumptions: [],
          dataRequirements: [],
          description: "Cycle",
          edges: [
            { sourceNodeKey: "discount_rate", targetNodeKey: "conversion_rate" },
            { sourceNodeKey: "conversion_rate", targetNodeKey: "discount_rate" },
          ],
          layoutJson: "{}",
          nodes: [
            {
              datasetColumnId: "column-1",
              label: "Discount rate",
              nodeKey: "discount_rate",
              nodeType: "treatment",
              observedStatus: "observed",
              sourceType: "dataset",
            },
            {
              datasetColumnId: "column-2",
              label: "Conversion rate",
              nodeKey: "conversion_rate",
              nodeType: "outcome",
              observedStatus: "observed",
              sourceType: "dataset",
            },
          ],
          primaryDatasetVersionId: "dataset-version-2",
          title: "Cyclic DAG",
        },
        organizationId: user!.organizationId,
      });

      expect(version.validation.errors).toContain("The DAG must be acyclic before approval.");

      await expect(
        approveAnalysisDagVersion({
          approvedByUserId: user!.id,
          dagId: dag.id,
          dagVersionId: version.dagVersionId,
          organizationId: user!.organizationId,
        }),
      ).rejects.toThrow(/acyclic/i);
    } finally {
      await environment.cleanup();
    }
  });

  it("stores approval on the exact DAG version and promotes the study to ready_to_run", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      const intake = await runAnalysisIntake({
        message: "What happens if we increase discount rate by five percent?",
        user: user!,
      });
      expect(intake.decision).toBe("open_rung2_study");
      if (intake.decision !== "open_rung2_study") {
        throw new Error("Expected analysis study creation.");
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

      const dag = await ensureAnalysisStudyDag({
        createdByUserId: user!.id,
        organizationId: user!.organizationId,
        studyId: intake.studyId,
        title: "Approval DAG",
      });

      const version = await createAnalysisDagVersion({
        createdByUserId: user!.id,
        dagId: dag.id,
        draft: {
          assumptions: [],
          dataRequirements: [],
          description: "Valid DAG",
          edges: [
            { sourceNodeKey: "discount_rate", targetNodeKey: "conversion_rate" },
          ],
          layoutJson: "{}",
          nodes: [
            {
              datasetColumnId: "column-1",
              label: "Discount rate",
              nodeKey: "discount_rate",
              nodeType: "treatment",
              observedStatus: "observed",
              sourceType: "dataset",
            },
            {
              datasetColumnId: "column-2",
              label: "Conversion rate",
              nodeKey: "conversion_rate",
              nodeType: "outcome",
              observedStatus: "observed",
              sourceType: "dataset",
            },
          ],
          primaryDatasetVersionId: "dataset-version-2",
          title: "Approval DAG",
        },
        organizationId: user!.organizationId,
      });

      const approval = await approveAnalysisDagVersion({
        approvalText: "I confirm this DAG is ready for a analysis run.",
        approvedByUserId: user!.id,
        dagId: dag.id,
        dagVersionId: version.dagVersionId,
        organizationId: user!.organizationId,
      });

      const db = await getAppDatabase();
      const approvalRows = await db
        .select()
        .from(causalApprovals)
        .where(eq(causalApprovals.id, approval.approvalId));
      const dagRows = await db.select().from(causalDags).where(eq(causalDags.id, dag.id));
      const studyRows = await db.select().from(causalStudies).where(eq(causalStudies.id, intake.studyId));
      const workspace = await getAnalysisDagWorkspaceDetail({
        organizationId: user!.organizationId,
        studyId: intake.studyId,
      });

      expect(approvalRows).toHaveLength(1);
      expect(approvalRows[0]?.dagVersionId).toBe(version.dagVersionId);
      expect(dagRows[0]?.status).toBe("approved");
      expect(studyRows[0]?.status).toBe("ready_to_run");
      expect(workspace.approvals).toHaveLength(1);
    } finally {
      await environment.cleanup();
    }
  });
});
