import "server-only";

import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import {
  analysisApprovals,
  analysisAssumptions,
  analysisGraphEdges,
  analysisGraphNodes,
  analysisGraphs,
  analysisGraphVersions,
  analysisDataRequirements,
  analysisStudies,
  datasetVersionColumns,
} from "@/lib/app-schema";
import {
  buildDefaultAnalysisApprovalText,
  type AnalysisDagDatasetColumnReference,
  type DraftAnalysisDagInput,
  validateDraftAnalysisDag,
} from "@/lib/analysis-dag-validator";
import { assertStudyHasPinnedPrimaryDataset } from "@/lib/study-dataset-bindings";

export type AnalysisDagVersionSummary = {
  createdAt: number;
  id: string;
  outcomeNodeKey: string | null;
  treatmentNodeKey: string | null;
  validation: {
    errors: string[];
    warnings: string[];
  };
  versionNumber: number;
};

export type AnalysisDagWorkspaceDetail = {
  approvals: Array<{
    approvalKind: typeof analysisApprovals.$inferSelect.approvalKind;
    approvalText: string;
    approvedByUserId: string;
    createdAt: number;
    id: string;
  }>;
  currentVersion: null | {
    assumptions: Array<{
      assumptionType: typeof analysisAssumptions.$inferSelect.assumptionType;
      description: string;
      id: string;
      relatedEdgeId: string | null;
      relatedNodeId: string | null;
      status: typeof analysisAssumptions.$inferSelect.status;
    }>;
    dataRequirements: Array<{
      id: string;
      importanceRank: number | null;
      reasonNeeded: string;
      relatedNodeId: string | null;
      status: typeof analysisDataRequirements.$inferSelect.status;
      suggestedSource: string | null;
      variableLabel: string;
    }>;
    edges: Array<{
      edgeKey: string;
      id: string;
      note: string | null;
      relationshipLabel: string;
      sourceNodeId: string;
      targetNodeId: string;
    }>;
    graphJson: string;
    id: string;
    nodes: Array<{
      datasetColumnId: string | null;
      description: string | null;
      id: string;
      label: string;
      nodeKey: string;
      nodeType: typeof analysisGraphNodes.$inferSelect.nodeType;
      observedStatus: typeof analysisGraphNodes.$inferSelect.observedStatus;
      sourceType: typeof analysisGraphNodes.$inferSelect.sourceType;
    }>;
    outcomeNodeKey: string | null;
    primaryDatasetVersionId: string | null;
    treatmentNodeKey: string | null;
    validation: {
      errors: string[];
      warnings: string[];
    };
    versionNumber: number;
  };
  dag: null | {
    currentVersionId: string | null;
    description: string | null;
    id: string;
    status: typeof analysisGraphs.$inferSelect.status;
    title: string;
    versions: AnalysisDagVersionSummary[];
  };
};

function parseValidationSummary(value: string) {
  try {
    const parsed = JSON.parse(value) as { errors?: unknown; warnings?: unknown };
    return {
      errors: Array.isArray(parsed.errors) ? parsed.errors.filter((item): item is string => typeof item === "string") : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === "string") : [],
    };
  } catch {
    return { errors: [], warnings: [] };
  }
}

async function requireStudyAndDag(input: {
  dagId: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(analysisGraphs)
    .where(
      and(eq(analysisGraphs.id, input.dagId), eq(analysisGraphs.organizationId, input.organizationId)),
    )
    .limit(1);

  const dag = rows[0] ?? null;
  if (!dag) {
    throw new Error("Analysis DAG not found.");
  }

  const studyRows = await db
    .select()
    .from(analysisStudies)
    .where(
      and(eq(analysisStudies.id, dag.studyId), eq(analysisStudies.organizationId, input.organizationId)),
    )
    .limit(1);

  const study = studyRows[0] ?? null;
  if (!study) {
    throw new Error("Analysis study not found for DAG.");
  }

  return { dag, study };
}

async function getDatasetColumnReferenceMap(organizationId: string, datasetVersionId: string | null | undefined) {
  const db = await getAppDatabase();

  if (!datasetVersionId) {
    return new Map<string, AnalysisDagDatasetColumnReference>();
  }

  const rows = await db
    .select()
    .from(datasetVersionColumns)
    .where(
      and(
        eq(datasetVersionColumns.organizationId, organizationId),
        eq(datasetVersionColumns.datasetVersionId, datasetVersionId),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.id,
      {
        columnName: row.columnName,
        datasetVersionId: row.datasetVersionId,
        displayName: row.displayName,
        id: row.id,
      } satisfies AnalysisDagDatasetColumnReference,
    ]),
  );
}

export async function ensureAnalysisStudyDag(input: {
  createdByUserId: string;
  description?: string | null;
  organizationId: string;
  studyId: string;
  title?: string | null;
}) {
  const db = await getAppDatabase();
  const studyRows = await db
    .select()
    .from(analysisStudies)
    .where(
      and(eq(analysisStudies.id, input.studyId), eq(analysisStudies.organizationId, input.organizationId)),
    )
    .limit(1);

  const study = studyRows[0] ?? null;
  if (!study) {
    throw new Error("Analysis study not found.");
  }

  if (study.currentDagId) {
    const existingRows = await db
      .select()
      .from(analysisGraphs)
      .where(eq(analysisGraphs.id, study.currentDagId))
      .limit(1);
    const existing = existingRows[0] ?? null;
    if (existing) {
      return existing;
    }
  }

  const now = Date.now();
  const dag = {
    id: randomUUID(),
    studyId: input.studyId,
    organizationId: input.organizationId,
    title: input.title?.trim() || study.title,
    description: input.description?.trim() || study.description || null,
    status: "draft" as const,
    currentVersionId: null,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof analysisGraphs.$inferInsert;

  await db.insert(analysisGraphs).values(dag);
  await db
    .update(analysisStudies)
    .set({
      currentDagId: dag.id,
      status: study.status === "awaiting_dataset" ? "awaiting_dag" : study.status,
      updatedAt: now,
    })
    .where(eq(analysisStudies.id, study.id));

  return dag;
}

export async function createAnalysisDagVersion(input: {
  createdByUserId: string;
  dagId: string;
  draft: DraftAnalysisDagInput;
  organizationId: string;
}) {
  const { dag, study } = await requireStudyAndDag({
    dagId: input.dagId,
    organizationId: input.organizationId,
  });
  const db = await getAppDatabase();
  const datasetColumnMap = await getDatasetColumnReferenceMap(
    input.organizationId,
    input.draft.primaryDatasetVersionId,
  );
  const validationResult = validateDraftAnalysisDag({
    datasetColumnMap,
    draft: input.draft,
    requirePinnedPrimaryDataset: false,
  });
  const versionNumberRow = await db
    .select({ maxVersionNumber: max(analysisGraphVersions.versionNumber) })
    .from(analysisGraphVersions)
    .where(eq(analysisGraphVersions.dagId, dag.id));
  const versionNumber = (versionNumberRow[0]?.maxVersionNumber ?? 0) + 1;
  const versionId = randomUUID();
  const now = Date.now();

  await db.transaction((transaction) => {
    transaction
      .insert(analysisGraphVersions)
      .values({
        id: versionId,
        dagId: dag.id,
        studyId: study.id,
        organizationId: input.organizationId,
        versionNumber,
        primaryDatasetVersionId: input.draft.primaryDatasetVersionId?.trim() || null,
        graphJson: validationResult.graphJson,
        validationJson: validationResult.validationJson,
        layoutJson: input.draft.layoutJson?.trim() || "{}",
        treatmentNodeKey: validationResult.treatmentNodeKey,
        outcomeNodeKey: validationResult.outcomeNodeKey,
        createdByUserId: input.createdByUserId,
        createdAt: now,
      })
      .run();

    const nodeIdByKey = new Map<string, string>();

    for (const node of input.draft.nodes) {
      const nodeId = randomUUID();
      nodeIdByKey.set(node.nodeKey, nodeId);
      const column = node.datasetColumnId ? datasetColumnMap.get(node.datasetColumnId) ?? null : null;

      transaction
        .insert(analysisGraphNodes)
        .values({
          id: nodeId,
          dagVersionId: versionId,
          studyId: study.id,
          organizationId: input.organizationId,
          nodeKey: node.nodeKey.trim(),
          label: node.label.trim(),
          nodeType: node.nodeType as typeof analysisGraphNodes.$inferInsert.nodeType,
          sourceType: node.sourceType as typeof analysisGraphNodes.$inferInsert.sourceType,
          observedStatus: node.observedStatus as typeof analysisGraphNodes.$inferInsert.observedStatus,
          datasetVersionId: column?.datasetVersionId ?? null,
          datasetColumnId: node.datasetColumnId?.trim() || null,
          description: node.description?.trim() || null,
          assumptionNote: node.assumptionNote?.trim() || null,
          positionX: typeof node.positionX === "number" ? node.positionX : null,
          positionY: typeof node.positionY === "number" ? node.positionY : null,
          metadataJson: node.metadataJson?.trim() || "{}",
          createdAt: now,
        })
        .run();
    }

    const edgeIdByKey = new Map<string, string>();

    for (const edge of input.draft.edges) {
      const edgeKey = edge.edgeKey?.trim() || `${edge.sourceNodeKey}->${edge.targetNodeKey}`;
      const edgeId = randomUUID();
      edgeIdByKey.set(edgeKey, edgeId);
      transaction
        .insert(analysisGraphEdges)
        .values({
          id: edgeId,
          dagVersionId: versionId,
          studyId: study.id,
          organizationId: input.organizationId,
          edgeKey,
          sourceNodeId: nodeIdByKey.get(edge.sourceNodeKey) ?? "",
          targetNodeId: nodeIdByKey.get(edge.targetNodeKey) ?? "",
          relationshipLabel: edge.relationshipLabel?.trim() || "causes",
          note: edge.note?.trim() || null,
          createdAt: now,
        })
        .run();
    }

    for (const assumption of input.draft.assumptions) {
      transaction
        .insert(analysisAssumptions)
        .values({
          id: randomUUID(),
          dagVersionId: versionId,
          studyId: study.id,
          organizationId: input.organizationId,
          assumptionType: assumption.assumptionType as typeof analysisAssumptions.$inferInsert.assumptionType,
          description: assumption.description.trim(),
          status: (assumption.status?.trim() || "asserted") as typeof analysisAssumptions.$inferInsert.status,
          relatedNodeId: assumption.relatedNodeKey ? (nodeIdByKey.get(assumption.relatedNodeKey) ?? null) : null,
          relatedEdgeId: assumption.relatedEdgeKey ? (edgeIdByKey.get(assumption.relatedEdgeKey) ?? null) : null,
          createdByUserId: input.createdByUserId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    for (const requirement of input.draft.dataRequirements) {
      transaction
        .insert(analysisDataRequirements)
        .values({
          id: randomUUID(),
          dagVersionId: versionId,
          studyId: study.id,
          organizationId: input.organizationId,
          relatedNodeId: requirement.relatedNodeKey
            ? (nodeIdByKey.get(requirement.relatedNodeKey) ?? null)
            : null,
          variableLabel: requirement.variableLabel.trim(),
          status: (requirement.status?.trim() || "missing") as typeof analysisDataRequirements.$inferInsert.status,
          importanceRank:
            typeof requirement.importanceRank === "number" ? Math.trunc(requirement.importanceRank) : null,
          reasonNeeded: requirement.reasonNeeded.trim(),
          suggestedSource: requirement.suggestedSource?.trim() || null,
          createdByUserId: input.createdByUserId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    transaction
      .update(analysisGraphs)
      .set({
        currentVersionId: versionId,
        status: "ready_for_approval",
        title: input.draft.title?.trim() || dag.title,
        description: input.draft.description?.trim() || dag.description,
        updatedAt: now,
      })
      .where(eq(analysisGraphs.id, dag.id))
      .run();

    transaction
      .update(analysisStudies)
      .set({
        currentDagId: dag.id,
        currentDagVersionId: versionId,
        status: "awaiting_approval",
        updatedAt: now,
      })
      .where(eq(analysisStudies.id, study.id))
      .run();
  });

  return {
    dagVersionId: versionId,
    validation: validationResult.validation,
    versionNumber,
  };
}

export async function approveAnalysisDagVersion(input: {
  approvalKind?: typeof analysisApprovals.$inferInsert.approvalKind;
  approvalText?: string | null;
  approvedByUserId: string;
  dagId: string;
  dagVersionId: string;
  organizationId: string;
}) {
  const { dag, study } = await requireStudyAndDag({
    dagId: input.dagId,
    organizationId: input.organizationId,
  });
  const db = await getAppDatabase();
  const versionRows = await db
    .select()
    .from(analysisGraphVersions)
    .where(
      and(
        eq(analysisGraphVersions.id, input.dagVersionId),
        eq(analysisGraphVersions.dagId, dag.id),
      ),
    )
    .limit(1);
  const version = versionRows[0] ?? null;

  if (!version) {
    throw new Error("Analysis DAG version not found.");
  }

  await assertStudyHasPinnedPrimaryDataset({
    organizationId: input.organizationId,
    studyId: study.id,
  });

  const datasetColumnRows = version.primaryDatasetVersionId
    ? await db
        .select()
        .from(datasetVersionColumns)
        .where(
          and(
            eq(datasetVersionColumns.organizationId, input.organizationId),
            eq(datasetVersionColumns.datasetVersionId, version.primaryDatasetVersionId),
          ),
        )
    : [];

  const nodes = await db
    .select()
    .from(analysisGraphNodes)
    .where(eq(analysisGraphNodes.dagVersionId, version.id))
    .orderBy(asc(analysisGraphNodes.createdAt));
  const edges = await db
    .select()
    .from(analysisGraphEdges)
    .where(eq(analysisGraphEdges.dagVersionId, version.id))
    .orderBy(asc(analysisGraphEdges.createdAt));
  const assumptions = await db
    .select()
    .from(analysisAssumptions)
    .where(eq(analysisAssumptions.dagVersionId, version.id))
    .orderBy(asc(analysisAssumptions.createdAt));
  const dataRequirements = await db
    .select()
    .from(analysisDataRequirements)
    .where(eq(analysisDataRequirements.dagVersionId, version.id))
    .orderBy(asc(analysisDataRequirements.createdAt));

  const datasetColumnMap = new Map(
    datasetColumnRows.map((row) => [
      row.id,
      {
        columnName: row.columnName,
        datasetVersionId: row.datasetVersionId,
        displayName: row.displayName,
        id: row.id,
      } satisfies AnalysisDagDatasetColumnReference,
    ]),
  );

  const edgeKeyById = new Map(edges.map((edge) => [edge.id, edge.edgeKey]));
  const nodeKeyById = new Map(nodes.map((node) => [node.id, node.nodeKey]));

  const validationResult = validateDraftAnalysisDag({
    datasetColumnMap,
    draft: {
      assumptions: assumptions.map((assumption) => ({
        assumptionType: assumption.assumptionType,
        description: assumption.description,
        relatedEdgeKey: assumption.relatedEdgeId ? (edgeKeyById.get(assumption.relatedEdgeId) ?? null) : null,
        relatedNodeKey: assumption.relatedNodeId ? (nodeKeyById.get(assumption.relatedNodeId) ?? null) : null,
        status: assumption.status,
      })),
      dataRequirements: dataRequirements.map((requirement) => ({
        importanceRank: requirement.importanceRank,
        reasonNeeded: requirement.reasonNeeded,
        relatedNodeKey: requirement.relatedNodeId ? (nodeKeyById.get(requirement.relatedNodeId) ?? null) : null,
        status: requirement.status,
        suggestedSource: requirement.suggestedSource,
        variableLabel: requirement.variableLabel,
      })),
      edges: edges.map((edge) => ({
        edgeKey: edge.edgeKey,
        note: edge.note,
        relationshipLabel: edge.relationshipLabel,
        sourceNodeKey: nodeKeyById.get(edge.sourceNodeId) ?? "",
        targetNodeKey: nodeKeyById.get(edge.targetNodeId) ?? "",
      })),
      layoutJson: version.layoutJson,
      nodes: nodes.map((node) => ({
        assumptionNote: node.assumptionNote,
        datasetColumnId: node.datasetColumnId,
        description: node.description,
        label: node.label,
        metadataJson: node.metadataJson,
        nodeKey: node.nodeKey,
        nodeType: node.nodeType,
        observedStatus: node.observedStatus,
        positionX: null,
        positionY: null,
        sourceType: node.sourceType,
      })),
      primaryDatasetVersionId: version.primaryDatasetVersionId,
    },
    requirePinnedPrimaryDataset: true,
  });

  if (validationResult.validation.errors.length > 0) {
    throw new Error(validationResult.validation.errors[0] ?? "DAG validation failed.");
  }

  const now = Date.now();
  const approvalId = randomUUID();
  const approvalText = input.approvalText?.trim() || buildDefaultAnalysisApprovalText();

  await db.transaction((transaction) => {
    transaction
      .insert(analysisApprovals)
      .values({
        id: approvalId,
        dagVersionId: version.id,
        studyId: study.id,
        organizationId: input.organizationId,
        approvedByUserId: input.approvedByUserId,
        approvalKind: input.approvalKind ?? "user_signoff",
        approvalText,
        approvalHash: null,
        createdAt: now,
      })
      .run();

    transaction
      .update(analysisGraphs)
      .set({
        currentVersionId: version.id,
        status: "approved",
        updatedAt: now,
      })
      .where(eq(analysisGraphs.id, dag.id))
      .run();

    transaction
      .update(analysisStudies)
      .set({
        currentDagId: dag.id,
        currentDagVersionId: version.id,
        status: "ready_to_run",
        updatedAt: now,
      })
      .where(eq(analysisStudies.id, study.id))
      .run();
  });

  return {
    approvalId,
    approvalText,
    dagVersionId: version.id,
  };
}

export async function getAnalysisDagWorkspaceDetail(input: {
  organizationId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const studyRows = await db
    .select()
    .from(analysisStudies)
    .where(
      and(eq(analysisStudies.id, input.studyId), eq(analysisStudies.organizationId, input.organizationId)),
    )
    .limit(1);
  const study = studyRows[0] ?? null;

  if (!study || !study.currentDagId) {
    return {
      approvals: [],
      currentVersion: null,
      dag: null,
    } satisfies AnalysisDagWorkspaceDetail;
  }

  const dagRows = await db
    .select()
    .from(analysisGraphs)
    .where(eq(analysisGraphs.id, study.currentDagId))
    .limit(1);
  const dag = dagRows[0] ?? null;

  if (!dag) {
    return {
      approvals: [],
      currentVersion: null,
      dag: null,
    } satisfies AnalysisDagWorkspaceDetail;
  }

  const versionRows = await db
    .select()
    .from(analysisGraphVersions)
    .where(eq(analysisGraphVersions.dagId, dag.id))
    .orderBy(desc(analysisGraphVersions.versionNumber));

  const versionIds = versionRows.map((version) => version.id);
  const currentVersion = versionRows.find((version) => version.id === dag.currentVersionId) ?? null;

  const currentNodes = currentVersion
    ? await db
        .select()
        .from(analysisGraphNodes)
        .where(eq(analysisGraphNodes.dagVersionId, currentVersion.id))
        .orderBy(asc(analysisGraphNodes.createdAt))
    : [];
  const currentEdges = currentVersion
    ? await db
        .select()
        .from(analysisGraphEdges)
        .where(eq(analysisGraphEdges.dagVersionId, currentVersion.id))
        .orderBy(asc(analysisGraphEdges.createdAt))
    : [];
  const currentAssumptions = currentVersion
    ? await db
        .select()
        .from(analysisAssumptions)
        .where(eq(analysisAssumptions.dagVersionId, currentVersion.id))
        .orderBy(asc(analysisAssumptions.createdAt))
    : [];
  const currentDataRequirements = currentVersion
    ? await db
        .select()
        .from(analysisDataRequirements)
        .where(eq(analysisDataRequirements.dagVersionId, currentVersion.id))
        .orderBy(asc(analysisDataRequirements.createdAt))
    : [];
  const approvalRows = versionIds.length
    ? await db
        .select()
        .from(analysisApprovals)
        .where(inArray(analysisApprovals.dagVersionId, versionIds))
        .orderBy(desc(analysisApprovals.createdAt))
    : [];

  return {
    approvals: approvalRows.map((approval) => ({
      approvalKind: approval.approvalKind,
      approvalText: approval.approvalText,
      approvedByUserId: approval.approvedByUserId,
      createdAt: approval.createdAt,
      id: approval.id,
    })),
    currentVersion: currentVersion
      ? {
          assumptions: currentAssumptions.map((assumption) => ({
            assumptionType: assumption.assumptionType,
            description: assumption.description,
            id: assumption.id,
            relatedEdgeId: assumption.relatedEdgeId,
            relatedNodeId: assumption.relatedNodeId,
            status: assumption.status,
          })),
          dataRequirements: currentDataRequirements.map((requirement) => ({
            id: requirement.id,
            importanceRank: requirement.importanceRank,
            reasonNeeded: requirement.reasonNeeded,
            relatedNodeId: requirement.relatedNodeId,
            status: requirement.status,
            suggestedSource: requirement.suggestedSource,
            variableLabel: requirement.variableLabel,
          })),
          edges: currentEdges.map((edge) => ({
            edgeKey: edge.edgeKey,
            id: edge.id,
            note: edge.note,
            relationshipLabel: edge.relationshipLabel,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
          })),
          graphJson: currentVersion.graphJson,
          id: currentVersion.id,
          nodes: currentNodes.map((node) => ({
            datasetColumnId: node.datasetColumnId,
            description: node.description,
            id: node.id,
            label: node.label,
            nodeKey: node.nodeKey,
            nodeType: node.nodeType,
            observedStatus: node.observedStatus,
            sourceType: node.sourceType,
          })),
          outcomeNodeKey: currentVersion.outcomeNodeKey,
          primaryDatasetVersionId: currentVersion.primaryDatasetVersionId,
          treatmentNodeKey: currentVersion.treatmentNodeKey,
          validation: parseValidationSummary(currentVersion.validationJson),
          versionNumber: currentVersion.versionNumber,
        }
      : null,
    dag: {
      currentVersionId: dag.currentVersionId,
      description: dag.description,
      id: dag.id,
      status: dag.status,
      title: dag.title,
      versions: versionRows.map((version) => ({
        createdAt: version.createdAt,
        id: version.id,
        outcomeNodeKey: version.outcomeNodeKey,
        treatmentNodeKey: version.treatmentNodeKey,
        validation: parseValidationSummary(version.validationJson),
        versionNumber: version.versionNumber,
      })),
    },
  } satisfies AnalysisDagWorkspaceDetail;
}
