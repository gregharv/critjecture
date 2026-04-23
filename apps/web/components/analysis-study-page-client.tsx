"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnalysisComparisonWorkspace } from "@/components/analysis-comparison-workspace";
import { AnalysisDagCanvas, getNodeAccent } from "@/components/analysis-dag-canvas";
import { AnalysisRunHighlights } from "@/components/analysis-run-highlights";

import {
  ANALYSIS_ASSUMPTION_STATUS_VALUES,
  ANALYSIS_ASSUMPTION_TYPE_VALUES,
  ANALYSIS_DATA_REQUIREMENT_STATUS_VALUES,
  ANALYSIS_DAG_NODE_OBSERVED_STATUS_VALUES,
  ANALYSIS_DAG_NODE_TYPE_VALUES,
} from "@/lib/analysis-dag-values";
import { evaluateAnalysisDraftDagGuardrails } from "@/lib/analysis-dag-draft-guardrails";
import { analyzeAnalysisDraftDagPaths } from "@/lib/analysis-dag-path-assistance";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type StudyDatasetCatalogItem = {
  accessScope: "public" | "admin";
  activeVersionId: string | null;
  dataKind: "table" | "spreadsheet" | "panel" | "event_log";
  datasetKey: string;
  description: string | null;
  displayName: string;
  id: string;
  status: "active" | "archived" | "deprecated";
  versions: Array<{
    contentHash: string;
    createdAt: number;
    id: string;
    ingestionStatus: "pending" | "profiling" | "ready" | "failed" | "archived";
    profileStatus: "pending" | "ready" | "failed";
    rowCount: number | null;
    versionNumber: number;
  }>;
};

type StudyDatasetBindingDetail = {
  bindings: Array<{
    bindingRole: "primary" | "auxiliary" | "candidate" | "external_requirement";
    dataset: {
      datasetKey: string;
      displayName: string;
      id: string;
    };
    datasetVersion: null | {
      id: string;
      rowCount: number | null;
      versionNumber: number;
    };
    id: string;
    isActive: boolean;
  }>;
  catalog: StudyDatasetCatalogItem[];
  readiness: {
    canApproveDag: boolean;
    canCreateRun: boolean;
    reasons: string[];
  };
  seedContract: null | {
    columns: Array<{
      columnName: string;
      columnOrder: number;
      displayName: string;
      id: string;
      nullable: boolean;
      physicalType: string;
      semanticType: string;
    }>;
    dataset: {
      displayName: string;
      id: string;
    };
    datasetVersion: {
      id: string;
      rowCount: number | null;
      versionNumber: number;
    };
  };
  studyId: string;
};

type AnalysisDagWorkspaceDetail = {
  approvals: Array<{
    approvalKind: "user_signoff" | "admin_signoff" | "compliance_signoff";
    approvalText: string;
    approvedByUserId: string;
    createdAt: number;
    id: string;
  }>;
  currentVersion: null | {
    graphJson: string;
    id: string;
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
    status: string;
    title: string;
    versions: Array<{
      createdAt: number;
      id: string;
      outcomeNodeKey: string | null;
      treatmentNodeKey: string | null;
      validation: {
        errors: string[];
        warnings: string[];
      };
      versionNumber: number;
    }>;
  };
};

type AnalysisRunSummary = {
  adjustmentSet: string[];
  answerCount: number;
  artifactCount: number;
  blockingReasons: string[];
  completedAt: number | null;
  createdAt: number;
  estimandLabels: string[];
  estimatorName: string | null;
  id: string;
  identificationMethod: string | null;
  identified: boolean | null;
  outcomeNodeKey: string;
  primaryEstimateIntervalHigh: number | null;
  primaryEstimateIntervalLow: number | null;
  primaryEstimateValue: number | null;
  refutationCount: number;
  refuterNames: string[];
  status: string;
  treatmentNodeKey: string;
};

type AnalysisAnswerSummary = {
  createdAt: number;
  id: string;
  modelName: string;
  promptVersion: string;
  runId: string;
};

type CurrentQuestionSummary = {
  id: string;
  proposedOutcomeLabel: string | null;
  proposedTreatmentLabel: string | null;
  questionText: string;
  questionType: string;
} | null;

type AnalysisStudyPageClientProps = {
  initialAnswers: AnalysisAnswerSummary[];
  initialComparison: {
    baseRunId: string | null;
    targetRunId: string | null;
  };
  initialComparisonState: {
    recentComparisons: RecentComparisonEntry[];
    snapshots: ComparisonSnapshot[];
  };
  initialCurrentQuestion: CurrentQuestionSummary;
  initialDagWorkspace: AnalysisDagWorkspaceDetail;
  initialDatasetBinding: StudyDatasetBindingDetail;
  initialRuns: AnalysisRunSummary[];
  study: {
    createdAt: number;
    description: string | null;
    id: string;
    status: string;
    title: string;
    updatedAt: number;
  };
};

type DagDraftNode = {
  datasetColumnId: string | null;
  description: string;
  label: string;
  nodeKey: string;
  nodeType: string;
  observedStatus: string;
  sourceType: string;
};

type DagDraftEdge = {
  edgeKey: string;
  note: string;
  relationshipLabel: string;
  sourceNodeKey: string;
  targetNodeKey: string;
};

type DagDraftAssumption = {
  assumptionType: string;
  description: string;
  relatedEdgeKey: string | null;
  relatedNodeKey: string | null;
  status: string;
};

type DagDraftDataRequirement = {
  importanceRank: number | null;
  reasonNeeded: string;
  relatedNodeKey: string | null;
  status: string;
  suggestedSource: string;
  variableLabel: string;
};

type DagDraft = {
  assumptions: DagDraftAssumption[];
  dataRequirements: DagDraftDataRequirement[];
  description: string;
  edges: DagDraftEdge[];
  layoutJson: string;
  nodes: DagDraftNode[];
  primaryDatasetVersionId: string | null;
  title: string;
};

type DagLayout = {
  positions?: Record<string, { x: number; y: number }>;
};

type ComparisonSnapshot = {
  baseRunId: string;
  createdAt: number;
  id: string;
  name: string;
  pinned: boolean;
  targetRunId: string;
  updatedAt: number;
};

type RecentComparisonEntry = {
  baseRunId: string;
  id: string;
  targetRunId: string;
  updatedAt: number;
};

const DEFAULT_APPROVAL_TEXT =
  "I confirm that this DAG reflects my current study assumptions, including observed variables, unobserved variables, and any external data still needed.";
function formatTimestamp(timestamp: number) {
  return DATE_TIME_FORMATTER.format(timestamp);
}

function formatLabel(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatNumber(value: number | null, digits = 4) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "not reported";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function compareRunSupport(left: AnalysisRunSummary, right: AnalysisRunSummary) {
  return (
    right.refutationCount - left.refutationCount ||
    right.answerCount - left.answerCount ||
    right.artifactCount - left.artifactCount ||
    (right.completedAt ?? 0) - (left.completedAt ?? 0) ||
    right.createdAt - left.createdAt
  );
}

function formatPreviewList(values: string[], emptyLabel: string, limit = 3) {
  if (!values.length) {
    return emptyLabel;
  }

  const preview = values.slice(0, limit).join(", ");
  return values.length > limit ? `${preview} +${values.length - limit} more` : preview;
}

function formatComparisonPairLabel(baseRunId: string, targetRunId: string) {
  return `${baseRunId} → ${targetRunId}`;
}

function diffStringSets(base: string[], target: string[]) {
  const baseSet = new Set(base);
  const targetSet = new Set(target);

  return {
    added: target.filter((value) => !baseSet.has(value)).sort((left, right) => left.localeCompare(right)),
    removed: base.filter((value) => !targetSet.has(value)).sort((left, right) => left.localeCompare(right)),
  };
}

function appendUniqueLabel(values: string[], value: string | null) {
  if (!value || values.includes(value)) {
    return values;
  }

  return [...values, value];
}

function getErrorMessage(value: unknown, fallbackMessage: string) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return fallbackMessage;
}

function normalizeDraftLabel(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSuggestedNodeType(input: {
  columnName: string;
  displayName: string;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  semanticType: string;
}) {
  const normalizedColumnName = normalizeDraftLabel(input.columnName);
  const normalizedDisplayName = normalizeDraftLabel(input.displayName);
  const normalizedTreatment = normalizeDraftLabel(input.proposedTreatmentLabel);
  const normalizedOutcome = normalizeDraftLabel(input.proposedOutcomeLabel);

  const matchesSuggestion = (candidate: string) =>
    candidate.length > 0 &&
    (normalizedColumnName.includes(candidate) || normalizedDisplayName.includes(candidate));

  if (matchesSuggestion(normalizedTreatment)) {
    return "treatment";
  }

  if (matchesSuggestion(normalizedOutcome)) {
    return "outcome";
  }

  return input.semanticType === "treatment_candidate"
    ? "treatment"
    : input.semanticType === "outcome_candidate"
      ? "outcome"
      : "observed_feature";
}

function resolveInitialComparison(input: {
  requestedBaseRunId?: string | null;
  requestedTargetRunId?: string | null;
  runs: AnalysisRunSummary[];
}) {
  const requestedBaseExists =
    !!input.requestedBaseRunId && input.runs.some((run) => run.id === input.requestedBaseRunId);
  const requestedTargetExists =
    !!input.requestedTargetRunId && input.runs.some((run) => run.id === input.requestedTargetRunId);

  const baseRunId =
    (requestedBaseExists ? input.requestedBaseRunId : null) ?? input.runs[0]?.id ?? "";
  let targetRunId =
    (requestedTargetExists ? input.requestedTargetRunId : null) ?? input.runs[1]?.id ?? input.runs[0]?.id ?? "";

  if (baseRunId && targetRunId === baseRunId) {
    targetRunId = input.runs.find((run) => run.id !== baseRunId)?.id ?? baseRunId;
  }

  return {
    baseRunId,
    targetRunId,
  };
}

function getDraftAutosaveKey(studyId: string) {
  return `critjecture:analysis-draft:${studyId}`;
}

function getLegacyDraftAutosaveKey(studyId: string) {
  return `critjecture:analysis-draft:${studyId}`;
}

function parseDagLayout(layoutJson: string | null | undefined): DagLayout {
  if (!layoutJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(layoutJson) as DagLayout;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function updateDagLayoutPosition(input: {
  layoutJson: string;
  nodeKey: string;
  x: number;
  y: number;
}) {
  const layout = parseDagLayout(input.layoutJson);
  return JSON.stringify({
    ...layout,
    positions: {
      ...(layout.positions ?? {}),
      [input.nodeKey]: {
        x: input.x,
        y: input.y,
      },
    },
  });
}

function removeDagLayoutPosition(layoutJson: string, nodeKey: string) {
  const layout = parseDagLayout(layoutJson);

  if (!layout.positions || !(nodeKey in layout.positions)) {
    return layoutJson;
  }

  const nextPositions = { ...layout.positions };
  delete nextPositions[nodeKey];

  return JSON.stringify({
    ...layout,
    positions: nextPositions,
  });
}

function sortObjectKeys<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries) as T;
}

function canonicalizeDraft(draft: DagDraft | null) {
  if (!draft) {
    return null;
  }

  const parsedLayout = parseDagLayout(draft.layoutJson);
  const sortedPositions = sortObjectKeys(parsedLayout.positions ?? {});

  return {
    assumptions: [...draft.assumptions].sort((left, right) =>
      `${left.assumptionType}:${left.relatedNodeKey ?? ""}:${left.description}`.localeCompare(
        `${right.assumptionType}:${right.relatedNodeKey ?? ""}:${right.description}`,
      ),
    ),
    dataRequirements: [...draft.dataRequirements].sort((left, right) =>
      `${left.variableLabel}:${left.relatedNodeKey ?? ""}:${left.reasonNeeded}`.localeCompare(
        `${right.variableLabel}:${right.relatedNodeKey ?? ""}:${right.reasonNeeded}`,
      ),
    ),
    description: draft.description.trim(),
    edges: [...draft.edges]
      .map((edge) => ({
        ...edge,
        note: edge.note.trim(),
        relationshipLabel: edge.relationshipLabel.trim(),
      }))
      .sort((left, right) => left.edgeKey.localeCompare(right.edgeKey)),
    layout: {
      positions: sortedPositions,
    },
    nodes: [...draft.nodes]
      .map((node) => ({
        ...node,
        description: node.description.trim(),
        label: node.label.trim(),
      }))
      .sort((left, right) => left.nodeKey.localeCompare(right.nodeKey)),
    primaryDatasetVersionId: draft.primaryDatasetVersionId,
    title: draft.title.trim(),
  };
}

function areDraftsEquivalent(left: DagDraft | null, right: DagDraft | null) {
  return JSON.stringify(canonicalizeDraft(left)) === JSON.stringify(canonicalizeDraft(right));
}

function buildSeededDraft(
  datasetBinding: StudyDatasetBindingDetail,
  dagWorkspace: AnalysisDagWorkspaceDetail,
  studyQuestion: CurrentQuestionSummary,
  studyTitle: string,
): DagDraft | null {
  const seedContract = datasetBinding.seedContract;

  if (!seedContract) {
    return null;
  }

  return {
    assumptions: [],
    dataRequirements: [],
    description: dagWorkspace.dag?.description ?? "",
    edges: [],
    layoutJson: "{}",
    nodes: seedContract.columns.map((column) => ({
      datasetColumnId: column.id,
      description: "",
      label: column.displayName,
      nodeKey: column.columnName,
      nodeType: inferSuggestedNodeType({
        columnName: column.columnName,
        displayName: column.displayName,
        proposedOutcomeLabel: studyQuestion?.proposedOutcomeLabel,
        proposedTreatmentLabel: studyQuestion?.proposedTreatmentLabel,
        semanticType: column.semanticType,
      }),
      observedStatus: "observed",
      sourceType: "dataset",
    })),
    primaryDatasetVersionId: seedContract.datasetVersion.id,
    title: dagWorkspace.dag?.title ?? `${studyTitle} DAG`,
  };
}

function parseGraphJsonDraft(
  dagWorkspace: AnalysisDagWorkspaceDetail,
  fallbackSeedDraft: DagDraft | null,
): DagDraft | null {
  const graphJson = dagWorkspace.currentVersion?.graphJson;

  if (!graphJson) {
    return fallbackSeedDraft;
  }

  try {
    const parsed = JSON.parse(graphJson) as {
      assumptions?: DagDraftAssumption[];
      dataRequirements?: DagDraftDataRequirement[];
      edges?: DagDraftEdge[];
      layout?: Record<string, unknown>;
      nodes?: DagDraftNode[];
      primaryDatasetVersionId?: string | null;
      title?: string;
    };

    return {
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      dataRequirements: Array.isArray(parsed.dataRequirements) ? parsed.dataRequirements : [],
      description: dagWorkspace.dag?.description ?? "",
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      layoutJson: JSON.stringify(parsed.layout ?? {}),
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      primaryDatasetVersionId: parsed.primaryDatasetVersionId ?? null,
      title: dagWorkspace.dag?.title ?? "Analysis DAG",
    };
  } catch {
    return fallbackSeedDraft;
  }
}

export function AnalysisStudyPageClient({
  initialAnswers,
  initialComparison,
  initialComparisonState,
  initialCurrentQuestion,
  initialDagWorkspace,
  initialDatasetBinding,
  initialRuns,
  study,
}: AnalysisStudyPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [currentQuestion, setCurrentQuestion] = useState(initialCurrentQuestion);
  const [datasetBinding, setDatasetBinding] = useState(initialDatasetBinding);
  const [dagWorkspace, setDagWorkspace] = useState(initialDagWorkspace);
  const [runs, setRuns] = useState(initialRuns);
  const [answers, setAnswers] = useState(initialAnswers);
  const [studyTitle, setStudyTitle] = useState(study.title);
  const [studyDescription, setStudyDescription] = useState(study.description ?? "");
  const [studyStatus, setStudyStatus] = useState(study.status);
  const [studyUpdatedAt, setStudyUpdatedAt] = useState(study.updatedAt);
  const [selectedDatasetId, setSelectedDatasetId] = useState(
    initialDatasetBinding.seedContract?.dataset.id ?? initialDatasetBinding.catalog[0]?.id ?? "",
  );
  const [selectedDatasetVersionId, setSelectedDatasetVersionId] = useState(
    initialDatasetBinding.seedContract?.datasetVersion.id ??
      initialDatasetBinding.catalog[0]?.versions[0]?.id ??
      "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalText, setApprovalText] = useState(DEFAULT_APPROVAL_TEXT);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [comparisonBaseRunId, setComparisonBaseRunId] = useState<string>(
    () => resolveInitialComparison({
      requestedBaseRunId: initialComparison.baseRunId,
      requestedTargetRunId: initialComparison.targetRunId,
      runs: initialRuns,
    }).baseRunId,
  );
  const [comparisonTargetRunId, setComparisonTargetRunId] = useState<string>(
    () => resolveInitialComparison({
      requestedBaseRunId: initialComparison.baseRunId,
      requestedTargetRunId: initialComparison.targetRunId,
      runs: initialRuns,
    }).targetRunId,
  );
  const [comparisonLinkStatus, setComparisonLinkStatus] = useState<null | "copied" | "failed">(null);
  const [comparisonSnapshots, setComparisonSnapshots] = useState<ComparisonSnapshot[]>(initialComparisonState.snapshots);
  const [recentComparisons, setRecentComparisons] = useState<RecentComparisonEntry[]>(initialComparisonState.recentComparisons);
  const [comparisonPendingAction, setComparisonPendingAction] = useState<string | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonSuccessMessage, setComparisonSuccessMessage] = useState<string | null>(null);
  const [comparisonLastSyncedAt, setComparisonLastSyncedAt] = useState<number | null>(
    initialComparisonState.snapshots.length || initialComparisonState.recentComparisons.length
      ? Date.now()
      : null,
  );
  const [newComparisonSnapshotName, setNewComparisonSnapshotName] = useState("");
  const [editingComparisonSnapshotId, setEditingComparisonSnapshotId] = useState<string | null>(null);
  const dagCanvasSectionRef = useRef<HTMLDivElement | null>(null);
  const comparisonPending = comparisonPendingAction !== null;
  const lastTrackedComparisonPairRef = useRef<string | null>(null);
  const [newCustomNode, setNewCustomNode] = useState({
    label: "",
    nodeKey: "",
    nodeType: "latent",
    observedStatus: "unobserved",
  });
  const [newEdge, setNewEdge] = useState({
    relationshipLabel: "causes",
    sourceNodeKey: "",
    targetNodeKey: "",
  });
  const [newAssumption, setNewAssumption] = useState({
    assumptionType: "custom",
    description: "",
    relatedNodeKey: "",
    status: "asserted",
  });
  const [newDataRequirement, setNewDataRequirement] = useState({
    reasonNeeded: "",
    relatedNodeKey: "",
    status: "missing",
    suggestedSource: "",
    variableLabel: "",
  });

  const [dagDraft, setDagDraft] = useState<DagDraft | null>(() => {
    const seeded = buildSeededDraft(initialDatasetBinding, initialDagWorkspace, initialCurrentQuestion, study.title);

    if (typeof window !== "undefined") {
      const autosaveKey = getDraftAutosaveKey(study.id);
      const legacyAutosaveKey = getLegacyDraftAutosaveKey(study.id);
      const autosaved =
        window.localStorage.getItem(autosaveKey) ?? window.localStorage.getItem(legacyAutosaveKey);

      if (autosaved) {
        try {
          const parsed = JSON.parse(autosaved) as DagDraft;
          if (!window.localStorage.getItem(autosaveKey)) {
            window.localStorage.setItem(autosaveKey, autosaved);
          }
          if (window.localStorage.getItem(legacyAutosaveKey)) {
            window.localStorage.removeItem(legacyAutosaveKey);
          }
          return parsed;
        } catch {
          return parseGraphJsonDraft(initialDagWorkspace, seeded);
        }
      }
    }

    return parseGraphJsonDraft(initialDagWorkspace, seeded);
  });

  const selectedDataset = useMemo(
    () => datasetBinding.catalog.find((dataset) => dataset.id === selectedDatasetId) ?? null,
    [datasetBinding.catalog, selectedDatasetId],
  );

  const sortedNodeOptions = useMemo(
    () => [...(dagDraft?.nodes ?? [])].sort((left, right) => left.nodeKey.localeCompare(right.nodeKey)),
    [dagDraft?.nodes],
  );
  const dagNodePositions = useMemo(
    () => parseDagLayout(dagDraft?.layoutJson).positions ?? {},
    [dagDraft?.layoutJson],
  );
  const savedCurrentVersionDraft = useMemo(() => {
    const seeded = buildSeededDraft(datasetBinding, dagWorkspace, currentQuestion, studyTitle);
    return parseGraphJsonDraft(dagWorkspace, seeded);
  }, [currentQuestion, dagWorkspace, datasetBinding, studyTitle]);
  const draftGuardrails = useMemo(
    () =>
      dagDraft
        ? evaluateAnalysisDraftDagGuardrails({
            datasetColumnIds: datasetBinding.seedContract?.columns.map((column) => column.id),
            draft: dagDraft,
            requirePinnedPrimaryDataset: true,
          })
        : null,
    [dagDraft, datasetBinding.seedContract],
  );
  const draftPathAssistance = useMemo(
    () =>
      dagDraft
        ? analyzeAnalysisDraftDagPaths({
            edges: dagDraft.edges,
            nodes: dagDraft.nodes,
          })
        : null,
    [dagDraft],
  );
  const hasUnsavedDagChanges = useMemo(
    () => !areDraftsEquivalent(dagDraft, savedCurrentVersionDraft),
    [dagDraft, savedCurrentVersionDraft],
  );
  const selectedDraftNode = useMemo(
    () => dagDraft?.nodes.find((node) => node.nodeKey === selectedNodeKey) ?? null,
    [dagDraft?.nodes, selectedNodeKey],
  );
  const selectedDraftEdge = useMemo(
    () => dagDraft?.edges.find((edge) => edge.edgeKey === selectedEdgeKey) ?? null,
    [dagDraft?.edges, selectedEdgeKey],
  );
  const treatmentNodes = useMemo(
    () => (dagDraft?.nodes ?? []).filter((node) => node.nodeType === "treatment"),
    [dagDraft?.nodes],
  );
  const outcomeNodes = useMemo(
    () => (dagDraft?.nodes ?? []).filter((node) => node.nodeType === "outcome"),
    [dagDraft?.nodes],
  );
  const errorNodeKeys = useMemo(
    () =>
      Object.entries(draftGuardrails?.nodeIssues ?? {})
        .filter(([, issues]) => issues.some((issue) => issue.severity === "error"))
        .map(([nodeKey]) => nodeKey),
    [draftGuardrails?.nodeIssues],
  );
  const warningNodeKeys = useMemo(
    () =>
      Object.entries(draftGuardrails?.nodeIssues ?? {})
        .filter(
          ([, issues]) =>
            !issues.some((issue) => issue.severity === "error") &&
            issues.some((issue) => issue.severity === "warning"),
        )
        .map(([nodeKey]) => nodeKey),
    [draftGuardrails?.nodeIssues],
  );
  const errorEdgeKeys = useMemo(
    () =>
      Object.entries(draftGuardrails?.edgeIssues ?? {})
        .filter(([, issues]) => issues.some((issue) => issue.severity === "error"))
        .map(([edgeKey]) => edgeKey),
    [draftGuardrails?.edgeIssues],
  );
  const warningEdgeKeys = useMemo(
    () =>
      Object.entries(draftGuardrails?.edgeIssues ?? {})
        .filter(
          ([, issues]) =>
            !issues.some((issue) => issue.severity === "error") &&
            issues.some((issue) => issue.severity === "warning"),
        )
        .map(([edgeKey]) => edgeKey),
    [draftGuardrails?.edgeIssues],
  );
  const comparisonBaseRun = useMemo(
    () => runs.find((run) => run.id === comparisonBaseRunId) ?? null,
    [comparisonBaseRunId, runs],
  );
  const comparisonTargetRun = useMemo(
    () => runs.find((run) => run.id === comparisonTargetRunId) ?? null,
    [comparisonTargetRunId, runs],
  );
  const latestRun = useMemo(() => runs[0] ?? null, [runs]);
  const latestCompletedRun = useMemo(
    () => runs.find((run) => run.completedAt != null) ?? null,
    [runs],
  );
  const bestSupportedIdentifiedRun = useMemo(
    () =>
      [...runs]
        .filter((run) => run.identified === true)
        .sort(compareRunSupport)[0] ?? null,
    [runs],
  );
  const latestAnswerBearingRun = useMemo(
    () => runs.find((run) => run.answerCount > 0) ?? null,
    [runs],
  );
  const runHighlights = useMemo(
    () => [
      {
        description: "Most recently created run, even if packaging or answer generation is still in progress.",
        label: "Latest run",
        run: latestRun,
      },
      {
        description: "Newest run that finished execution and can usually be inspected immediately.",
        label: "Latest completed",
        run: latestCompletedRun,
      },
      {
        description: "Best supported identified run based on stored refutations, answers, and artifacts.",
        label: "Best identified",
        run: bestSupportedIdentifiedRun,
      },
      {
        description: "Newest run that already has at least one grounded final answer.",
        label: "Latest answer-bearing",
        run: latestAnswerBearingRun,
      },
    ],
    [bestSupportedIdentifiedRun, latestAnswerBearingRun, latestCompletedRun, latestRun],
  );
  const runBadgesByRunId = useMemo(() => {
    const badges = new Map<string, string[]>();

    for (const highlight of runHighlights) {
      if (!highlight.run) {
        continue;
      }

      badges.set(
        highlight.run.id,
        appendUniqueLabel(badges.get(highlight.run.id) ?? [], highlight.label),
      );
    }

    if (comparisonBaseRunId) {
      badges.set(
        comparisonBaseRunId,
        appendUniqueLabel(badges.get(comparisonBaseRunId) ?? [], "Current baseline"),
      );
    }

    if (comparisonTargetRunId) {
      badges.set(
        comparisonTargetRunId,
        appendUniqueLabel(badges.get(comparisonTargetRunId) ?? [], "Current comparison"),
      );
    }

    return badges;
  }, [comparisonBaseRunId, comparisonTargetRunId, runHighlights]);
  const comparisonAdjustmentDiff = useMemo(
    () =>
      comparisonBaseRun && comparisonTargetRun
        ? diffStringSets(comparisonBaseRun.adjustmentSet, comparisonTargetRun.adjustmentSet)
        : { added: [], removed: [] },
    [comparisonBaseRun, comparisonTargetRun],
  );
  const comparisonEstimandDiff = useMemo(
    () =>
      comparisonBaseRun && comparisonTargetRun
        ? diffStringSets(comparisonBaseRun.estimandLabels, comparisonTargetRun.estimandLabels)
        : { added: [], removed: [] },
    [comparisonBaseRun, comparisonTargetRun],
  );
  const comparisonBlockingReasonDiff = useMemo(
    () =>
      comparisonBaseRun && comparisonTargetRun
        ? diffStringSets(comparisonBaseRun.blockingReasons, comparisonTargetRun.blockingReasons)
        : { added: [], removed: [] },
    [comparisonBaseRun, comparisonTargetRun],
  );
  const comparisonRefuterDiff = useMemo(
    () =>
      comparisonBaseRun && comparisonTargetRun
        ? diffStringSets(comparisonBaseRun.refuterNames, comparisonTargetRun.refuterNames)
        : { added: [], removed: [] },
    [comparisonBaseRun, comparisonTargetRun],
  );
  const comparisonQueryString = useMemo(() => {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (comparisonBaseRunId) {
      nextParams.set("baseRunId", comparisonBaseRunId);
    } else {
      nextParams.delete("baseRunId");
    }

    if (comparisonTargetRunId) {
      nextParams.set("targetRunId", comparisonTargetRunId);
    } else {
      nextParams.delete("targetRunId");
    }

    return nextParams.toString();
  }, [comparisonBaseRunId, comparisonTargetRunId, searchParams]);
  const comparisonSharePath = useMemo(
    () => (comparisonQueryString ? `${pathname}?${comparisonQueryString}` : pathname),
    [comparisonQueryString, pathname],
  );
  const comparisonSnapshotsWithAvailability = useMemo(
    () =>
      comparisonSnapshots.map((snapshot) => ({
        ...snapshot,
        available:
          runs.some((run) => run.id === snapshot.baseRunId) &&
          runs.some((run) => run.id === snapshot.targetRunId),
      })),
    [comparisonSnapshots, runs],
  );
  const recentComparisonsWithAvailability = useMemo(
    () =>
      recentComparisons.map((entry) => ({
        ...entry,
        available:
          runs.some((run) => run.id === entry.baseRunId) &&
          runs.some((run) => run.id === entry.targetRunId),
      })),
    [recentComparisons, runs],
  );
  const nodeSuggestedEdgeActions = useMemo(() => {
    const byNodeKey: Record<
      string,
      Array<{ actionKey: string; label: string; sourceNodeKey: string; targetNodeKey: string }>
    > = {};

    for (const suggestion of draftPathAssistance?.suggestions ?? []) {
      if (!suggestion.sourceNodeKey || !suggestion.targetNodeKey) {
        continue;
      }

      const edgeKey = `${suggestion.sourceNodeKey}->${suggestion.targetNodeKey}`;
      const sourceAction = {
        actionKey: `${edgeKey}:source`,
        label: `+→ ${suggestion.targetNodeKey}`,
        sourceNodeKey: suggestion.sourceNodeKey,
        targetNodeKey: suggestion.targetNodeKey,
      };
      const targetAction = {
        actionKey: `${edgeKey}:target`,
        label: `+ ${suggestion.sourceNodeKey} →`,
        sourceNodeKey: suggestion.sourceNodeKey,
        targetNodeKey: suggestion.targetNodeKey,
      };

      byNodeKey[suggestion.sourceNodeKey] = [...(byNodeKey[suggestion.sourceNodeKey] ?? []), sourceAction];
      byNodeKey[suggestion.targetNodeKey] = [...(byNodeKey[suggestion.targetNodeKey] ?? []), targetAction];
    }

    return byNodeKey;
  }, [draftPathAssistance?.suggestions]);

  useEffect(() => {
    if (!dagDraft || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(getDraftAutosaveKey(study.id), JSON.stringify(dagDraft));
  }, [dagDraft, study.id]);


  useEffect(() => {
    if (selectedNodeKey && !dagDraft?.nodes.some((node) => node.nodeKey === selectedNodeKey)) {
      setSelectedNodeKey(null);
    }

    if (selectedEdgeKey && !dagDraft?.edges.some((edge) => edge.edgeKey === selectedEdgeKey)) {
      setSelectedEdgeKey(null);
    }
  }, [dagDraft?.edges, dagDraft?.nodes, selectedEdgeKey, selectedNodeKey]);

  useEffect(() => {
    const nextSelection = resolveInitialComparison({
      requestedBaseRunId: comparisonBaseRunId,
      requestedTargetRunId: comparisonTargetRunId,
      runs,
    });

    if (comparisonBaseRunId !== nextSelection.baseRunId) {
      setComparisonBaseRunId(nextSelection.baseRunId);
    }

    if (comparisonTargetRunId !== nextSelection.targetRunId) {
      setComparisonTargetRunId(nextSelection.targetRunId);
    }
  }, [comparisonBaseRunId, comparisonTargetRunId, runs]);

  useEffect(() => {
    const currentQuery = searchParams.toString();

    if (currentQuery === comparisonQueryString) {
      return;
    }

    router.replace(comparisonSharePath, { scroll: false });
  }, [comparisonQueryString, comparisonSharePath, router, searchParams]);

  useEffect(() => {
    if (!comparisonLinkStatus) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setComparisonLinkStatus(null);
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [comparisonLinkStatus]);

  useEffect(() => {
    setComparisonError(null);
  }, [comparisonBaseRunId, comparisonTargetRunId]);

  useEffect(() => {
    if (!comparisonSuccessMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setComparisonSuccessMessage(null);
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [comparisonSuccessMessage]);

  useEffect(() => {
    if (!comparisonBaseRunId || !comparisonTargetRunId || comparisonBaseRunId === comparisonTargetRunId) {
      return;
    }

    const pairKey = `${comparisonBaseRunId}::${comparisonTargetRunId}`;
    if (lastTrackedComparisonPairRef.current === pairKey) {
      return;
    }

    lastTrackedComparisonPairRef.current = pairKey;
    void updateComparisonState(
      {
        action: "track_recent",
        baseRunId: comparisonBaseRunId,
        targetRunId: comparisonTargetRunId,
      },
      {
        fallbackMessage: "Failed to update recent comparisons.",
        quiet: true,
      },
    ).catch(() => {
      lastTrackedComparisonPairRef.current = null;
    });
  }, [comparisonBaseRunId, comparisonTargetRunId, updateComparisonState]);

  function focusCanvasInspector() {
    dagCanvasSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function focusNode(nodeKey: string | null) {
    if (!nodeKey) {
      focusCanvasInspector();
      return;
    }

    setSelectedNodeKey(nodeKey);
    setSelectedEdgeKey(null);
    focusCanvasInspector();
  }

  function focusFirstDisconnectedNode() {
    const nodeKey = draftPathAssistance?.disconnectedNodeKeys[0] ?? null;
    focusNode(nodeKey);
    return nodeKey;
  }

  function focusFirstDraftIssue(severity: "error" | "warning" = "error") {
    const nodeEntry = Object.entries(draftGuardrails?.nodeIssues ?? {}).find(([, issues]) =>
      issues.some((issue) => issue.severity === severity),
    );

    if (nodeEntry) {
      focusNode(nodeEntry[0]);
      return nodeEntry[0];
    }

    const edgeEntry = Object.entries(draftGuardrails?.edgeIssues ?? {}).find(([, issues]) =>
      issues.some((issue) => issue.severity === severity),
    );

    if (edgeEntry) {
      setSelectedNodeKey(null);
      setSelectedEdgeKey(edgeEntry[0]);
      focusCanvasInspector();
      return edgeEntry[0];
    }

    focusCanvasInspector();
    return null;
  }

  async function refreshStudy(syncDraft = false) {
    const response = await fetch(`/api/analysis/studies/${study.id}`, {
      cache: "no-store",
    });
    const json = (await response.json()) as unknown;

    if (!response.ok) {
      throw new Error(getErrorMessage(json, "Failed to refresh analysis study."));
    }

    const next = json as {
      answers: AnalysisAnswerSummary[];
      comparisonState: {
        recentComparisons: RecentComparisonEntry[];
        snapshots: ComparisonSnapshot[];
      };
      currentQuestion: CurrentQuestionSummary;
      dagWorkspace: AnalysisDagWorkspaceDetail;
      datasetBinding: StudyDatasetBindingDetail;
      runs: AnalysisRunSummary[];
      study: {
        description: string | null;
        status: string;
        title: string;
        updatedAt: number;
      };
    };
    setCurrentQuestion(next.currentQuestion);
    setDatasetBinding(next.datasetBinding);
    setDagWorkspace(next.dagWorkspace);
    setRuns(next.runs);
    setAnswers(next.answers);
    setComparisonSnapshots(next.comparisonState.snapshots);
    setRecentComparisons(next.comparisonState.recentComparisons);
    setStudyTitle(next.study.title);
    setStudyDescription(next.study.description ?? "");
    setStudyStatus(next.study.status);
    setStudyUpdatedAt(next.study.updatedAt);

    if (syncDraft) {
      const seeded = buildSeededDraft(next.datasetBinding, next.dagWorkspace, next.currentQuestion, next.study.title);
      const nextDraft = parseGraphJsonDraft(next.dagWorkspace, seeded);
      setDagDraft(nextDraft);

      if (typeof window !== "undefined" && nextDraft) {
        window.localStorage.setItem(getDraftAutosaveKey(study.id), JSON.stringify(nextDraft));
      }
    }
  }

  const updateComparisonState = useCallback(
    async (
      body: Record<string, unknown>,
      options?: {
        fallbackMessage?: string;
        pendingLabel?: string;
        quiet?: boolean;
        successMessage?: string;
      },
    ) => {
      if (!options?.quiet) {
        setComparisonPendingAction(options?.pendingLabel ?? "Syncing comparison state…");
        setComparisonError(null);
        setComparisonSuccessMessage(null);
      }

      try {
        const response = await fetch(`/api/analysis/studies/${study.id}/comparison-state`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const json = (await response.json()) as unknown;

        if (!response.ok) {
          throw new Error(getErrorMessage(json, options?.fallbackMessage ?? "Failed to update comparison state."));
        }

        const next = json as {
          comparisonState: {
            recentComparisons: RecentComparisonEntry[];
            snapshots: ComparisonSnapshot[];
          };
        };

        setComparisonSnapshots(next.comparisonState.snapshots);
        setRecentComparisons(next.comparisonState.recentComparisons);
        setComparisonLastSyncedAt(Date.now());
        if (!options?.quiet && options?.successMessage) {
          setComparisonSuccessMessage(options.successMessage);
        }
      } catch (updateError) {
        if (!options?.quiet) {
          setComparisonError(
            updateError instanceof Error
              ? updateError.message
              : options?.fallbackMessage ?? "Failed to update comparison state.",
          );
        }
        throw updateError;
      } finally {
        if (!options?.quiet) {
          setComparisonPendingAction(null);
        }
      }
    },
    [study.id],
  );

  async function handleSaveStudyMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/analysis/studies/${study.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          description: studyDescription,
          title: studyTitle,
        }),
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to update the analysis study."));
      }

      await refreshStudy(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update the analysis study.");
    } finally {
      setPending(false);
    }
  }

  async function handleBindPrimaryDataset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDatasetId || !selectedDatasetVersionId) {
      setError("Choose both a dataset and an exact dataset version.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/analysis/studies/${study.id}/dataset-bindings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bindingRole: "primary",
          datasetId: selectedDatasetId,
          datasetVersionId: selectedDatasetVersionId,
        }),
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to pin the primary dataset."));
      }

      const payload = json as { datasetBinding: StudyDatasetBindingDetail };
      setDatasetBinding(payload.datasetBinding);

      if (!dagDraft) {
        const seeded = buildSeededDraft(payload.datasetBinding, dagWorkspace, currentQuestion, studyTitle);
        setDagDraft(seeded);
      } else {
        setDagDraft({
          ...dagDraft,
          primaryDatasetVersionId: selectedDatasetVersionId,
        });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to pin the primary dataset.",
      );
    } finally {
      setPending(false);
    }
  }

  function handleSeedDraftFromDataset() {
    const seeded = buildSeededDraft(datasetBinding, dagWorkspace, currentQuestion, studyTitle);

    if (!seeded) {
      setError("Pin a primary dataset version before seeding the DAG.");
      return;
    }

    setError(null);
    setDagDraft(seeded);
  }

  function updateDraftNode(nodeKey: string, patch: Partial<DagDraftNode>) {
    if (!dagDraft) {
      return;
    }

    setDagDraft({
      ...dagDraft,
      nodes: dagDraft.nodes.map((node) =>
        node.nodeKey === nodeKey
          ? {
              ...node,
              ...patch,
            }
          : node,
      ),
    });
  }

  function updateDraftEdge(edgeKey: string, patch: Partial<DagDraftEdge>) {
    if (!dagDraft) {
      return;
    }

    setDagDraft({
      ...dagDraft,
      edges: dagDraft.edges.map((edge) => (edge.edgeKey === edgeKey ? { ...edge, ...patch } : edge)),
    });
  }

  function removeDraftEdge(edgeKey: string) {
    if (!dagDraft) {
      return;
    }

    setDagDraft({
      ...dagDraft,
      edges: dagDraft.edges.filter((edge) => edge.edgeKey !== edgeKey),
    });
    setSelectedEdgeKey((current) => (current === edgeKey ? null : current));
  }

  function setExclusiveDraftNodeType(nodeKey: string, nodeType: "treatment" | "outcome") {
    if (!dagDraft) {
      return;
    }

    setDagDraft({
      ...dagDraft,
      nodes: dagDraft.nodes.map((node) => {
        if (node.nodeKey === nodeKey) {
          return {
            ...node,
            nodeType,
          };
        }

        if (node.nodeType === nodeType) {
          return {
            ...node,
            nodeType: "observed_feature",
          };
        }

        return node;
      }),
    });
    setSelectedNodeKey(nodeKey);
    setSelectedEdgeKey(null);
  }

  function autoArrangeDraftNodes() {
    if (!dagDraft) {
      return;
    }

    const buckets: Array<{ match: (node: DagDraftNode) => boolean; x: number }> = [
      { match: (node) => node.nodeType === "confounder" || node.nodeType === "instrument", x: 40 },
      { match: (node) => node.nodeType === "treatment", x: 300 },
      { match: (node) => node.nodeType === "mediator" || node.nodeType === "collider", x: 560 },
      { match: (node) => node.nodeType === "outcome", x: 820 },
      {
        match: (node) =>
          node.nodeType === "latent" ||
          node.nodeType === "external_data_needed" ||
          node.nodeType === "selection" ||
          node.nodeType === "note",
        x: 1080,
      },
    ];

    const positions: Record<string, { x: number; y: number }> = {};
    const rowCounts = new Map<number, number>();

    for (const node of dagDraft.nodes) {
      const bucket = buckets.find((candidate) => candidate.match(node));
      const x = bucket?.x ?? 560;
      const row = rowCounts.get(x) ?? 0;
      rowCounts.set(x, row + 1);
      positions[node.nodeKey] = {
        x,
        y: 40 + row * 150,
      };
    }

    setDagDraft({
      ...dagDraft,
      layoutJson: JSON.stringify({ positions }),
    });
  }

  function removeDraftNode(nodeKey: string) {
    if (!dagDraft) {
      return;
    }

    setDagDraft({
      ...dagDraft,
      assumptions: dagDraft.assumptions.map((assumption) =>
        assumption.relatedNodeKey === nodeKey ? { ...assumption, relatedNodeKey: null } : assumption,
      ),
      dataRequirements: dagDraft.dataRequirements.map((requirement) =>
        requirement.relatedNodeKey === nodeKey ? { ...requirement, relatedNodeKey: null } : requirement,
      ),
      edges: dagDraft.edges.filter(
        (edge) => edge.sourceNodeKey !== nodeKey && edge.targetNodeKey !== nodeKey,
      ),
      layoutJson: removeDagLayoutPosition(dagDraft.layoutJson, nodeKey),
      nodes: dagDraft.nodes.filter((node) => node.nodeKey !== nodeKey),
    });
    setSelectedNodeKey((current) => (current === nodeKey ? null : current));
    setSelectedEdgeKey((current) => {
      const affected = dagDraft.edges.some(
        (edge) => edge.edgeKey === current && (edge.sourceNodeKey === nodeKey || edge.targetNodeKey === nodeKey),
      );
      return affected ? null : current;
    });
  }

  function addCustomNode() {
    if (!dagDraft) {
      return;
    }

    if (!newCustomNode.nodeKey.trim() || !newCustomNode.label.trim()) {
      setError("Custom nodes need both a node key and a label.");
      return;
    }

    if (dagDraft.nodes.some((node) => node.nodeKey === newCustomNode.nodeKey.trim())) {
      setError("That node key already exists in the draft DAG.");
      return;
    }

    setError(null);
    setDagDraft({
      ...dagDraft,
      nodes: [
        ...dagDraft.nodes,
        {
          datasetColumnId: null,
          description: "",
          label: newCustomNode.label.trim(),
          nodeKey: newCustomNode.nodeKey.trim(),
          nodeType: newCustomNode.nodeType,
          observedStatus: newCustomNode.observedStatus,
          sourceType: "user",
        },
      ],
    });
    setNewCustomNode({
      label: "",
      nodeKey: "",
      nodeType: "latent",
      observedStatus: "unobserved",
    });
    setSelectedNodeKey(newCustomNode.nodeKey.trim());
    setSelectedEdgeKey(null);
  }

  function connectDraftEdge(input: {
    relationshipLabel?: string;
    sourceNodeKey: string;
    targetNodeKey: string;
  }) {
    if (!dagDraft) {
      return;
    }

    if (!input.sourceNodeKey || !input.targetNodeKey) {
      setError("Choose both a source and target node for each edge.");
      return;
    }

    if (input.sourceNodeKey === input.targetNodeKey) {
      setError("Edges cannot point from a node to itself.");
      return;
    }

    const edgeKey = `${input.sourceNodeKey}->${input.targetNodeKey}`;
    if (dagDraft.edges.some((edge) => edge.edgeKey === edgeKey)) {
      setError("That edge already exists in the draft DAG.");
      return;
    }

    setError(null);
    setDagDraft({
      ...dagDraft,
      edges: [
        ...dagDraft.edges,
        {
          edgeKey,
          note: "",
          relationshipLabel: input.relationshipLabel?.trim() || "causes",
          sourceNodeKey: input.sourceNodeKey,
          targetNodeKey: input.targetNodeKey,
        },
      ],
    });
    setSelectedNodeKey(null);
    setSelectedEdgeKey(edgeKey);
  }

  function addEdge() {
    connectDraftEdge(newEdge);
    setNewEdge({ relationshipLabel: "causes", sourceNodeKey: "", targetNodeKey: "" });
  }

  function applySuggestedBridge(input: { sourceNodeKey?: string; targetNodeKey?: string }) {
    if (!input.sourceNodeKey || !input.targetNodeKey) {
      setError("This suggestion does not include a concrete edge to apply.");
      return;
    }

    connectDraftEdge({
      relationshipLabel: newEdge.relationshipLabel || "causes",
      sourceNodeKey: input.sourceNodeKey,
      targetNodeKey: input.targetNodeKey,
    });
    setSelectedNodeKey(null);
    setSelectedEdgeKey(`${input.sourceNodeKey}->${input.targetNodeKey}`);
    focusCanvasInspector();
  }

  function updateDraftNodePosition(input: { nodeKey: string; x: number; y: number }) {
    if (!dagDraft) {
      return;
    }

    setDagDraft({
      ...dagDraft,
      layoutJson: updateDagLayoutPosition({
        layoutJson: dagDraft.layoutJson,
        nodeKey: input.nodeKey,
        x: input.x,
        y: input.y,
      }),
    });
  }

  function addAssumption() {
    if (!dagDraft) {
      return;
    }

    if (!newAssumption.description.trim()) {
      setError("Assumptions need a description.");
      return;
    }

    setError(null);
    setDagDraft({
      ...dagDraft,
      assumptions: [
        ...dagDraft.assumptions,
        {
          assumptionType: newAssumption.assumptionType,
          description: newAssumption.description.trim(),
          relatedEdgeKey: null,
          relatedNodeKey: newAssumption.relatedNodeKey || null,
          status: newAssumption.status,
        },
      ],
    });
    setNewAssumption({
      assumptionType: "custom",
      description: "",
      relatedNodeKey: "",
      status: "asserted",
    });
  }

  function addDataRequirement() {
    if (!dagDraft) {
      return;
    }

    if (!newDataRequirement.variableLabel.trim() || !newDataRequirement.reasonNeeded.trim()) {
      setError("Data requirements need both a variable label and a reason.");
      return;
    }

    setError(null);
    setDagDraft({
      ...dagDraft,
      dataRequirements: [
        ...dagDraft.dataRequirements,
        {
          importanceRank: null,
          reasonNeeded: newDataRequirement.reasonNeeded.trim(),
          relatedNodeKey: newDataRequirement.relatedNodeKey || null,
          status: newDataRequirement.status,
          suggestedSource: newDataRequirement.suggestedSource.trim(),
          variableLabel: newDataRequirement.variableLabel.trim(),
        },
      ],
    });
    setNewDataRequirement({
      reasonNeeded: "",
      relatedNodeKey: "",
      status: "missing",
      suggestedSource: "",
      variableLabel: "",
    });
  }

  function resetDraftToSavedVersion() {
    setError(null);
    setSelectedNodeKey(null);
    setSelectedEdgeKey(null);
    setDagDraft(savedCurrentVersionDraft);

    if (typeof window !== "undefined") {
      if (savedCurrentVersionDraft) {
        window.localStorage.setItem(getDraftAutosaveKey(study.id), JSON.stringify(savedCurrentVersionDraft));
      } else {
        window.localStorage.removeItem(getDraftAutosaveKey(study.id));
      }
    }
  }

  async function handleSaveDagVersion() {
    if (!dagDraft) {
      setError("Seed or build a draft DAG before saving a version.");
      return;
    }

    if ((draftGuardrails?.errors.length ?? 0) > 0) {
      focusFirstDraftIssue("error");
    }

    setPending(true);
    setError(null);

    try {
      let dagId = dagWorkspace.dag?.id ?? null;

      if (!dagId) {
        const dagResponse = await fetch(`/api/analysis/studies/${study.id}/dags`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            description: dagDraft.description,
            title: dagDraft.title,
          }),
        });
        const dagJson = (await dagResponse.json()) as unknown;

        if (!dagResponse.ok) {
          throw new Error(getErrorMessage(dagJson, "Failed to create the study DAG."));
        }

        dagId = ((dagJson as { dag: { id: string } }).dag.id);
      }

      const versionResponse = await fetch(`/api/analysis/dags/${dagId}/versions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(dagDraft),
      });
      const versionJson = (await versionResponse.json()) as unknown;

      if (!versionResponse.ok) {
        throw new Error(getErrorMessage(versionJson, "Failed to save the DAG version."));
      }

      await refreshStudy(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save the DAG version.");
    } finally {
      setPending(false);
    }
  }

  async function handleApproveDagVersion() {
    if (!dagWorkspace.dag?.id || !dagWorkspace.currentVersion?.id) {
      setError("Save a DAG version before approval.");
      return;
    }

    if (hasUnsavedDagChanges) {
      focusCanvasInspector();
      setError("Save or reset the local draft before approving. Approval always applies to the saved DAG version.");
      return;
    }

    if (dagWorkspace.currentVersion.validation.errors.length > 0) {
      focusFirstDraftIssue("error");
      setError("Resolve the blocking DAG guardrails before approval.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/analysis/dags/${dagWorkspace.dag.id}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          approvalText,
          dagVersionId: dagWorkspace.currentVersion.id,
        }),
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to approve the DAG version."));
      }

      await refreshStudy(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to approve the DAG version.");
    } finally {
      setPending(false);
    }
  }

  async function handleCreateRun() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/analysis/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ studyId: study.id }),
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to create the analysis run."));
      }

      await refreshStudy(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create the analysis run.");
    } finally {
      setPending(false);
    }
  }

  function setComparisonBaseline(runId: string) {
    setComparisonBaseRunId(runId);
    if (comparisonTargetRunId === runId) {
      setComparisonTargetRunId(runs.find((run) => run.id !== runId)?.id ?? runId);
    }
  }

  function setComparisonTarget(runId: string) {
    setComparisonTargetRunId(runId);
    if (comparisonBaseRunId === runId) {
      setComparisonBaseRunId(runs.find((run) => run.id !== runId)?.id ?? runId);
    }
  }

  function compareAgainstHighlight(runId: string) {
    setComparisonTarget(runId);
    if (!comparisonBaseRunId || comparisonBaseRunId === runId) {
      setComparisonBaseRunId(runs.find((run) => run.id !== runId)?.id ?? runId);
    }
  }

  function compareAgainstCurrentBaseline(runId: string) {
    if (!comparisonBaseRunId) {
      setComparisonBaseRunId(runs.find((run) => run.id !== runId)?.id ?? runId);
      setComparisonTargetRunId(runId);
      return;
    }

    if (comparisonBaseRunId === runId) {
      setComparisonTargetRunId(runs.find((run) => run.id !== runId)?.id ?? runId);
      return;
    }

    setComparisonTarget(runId);
  }

  async function upsertComparisonSnapshot(input: {
    baseRunId: string;
    name: string;
    targetRunId: string;
  }) {
    const trimmedName = input.name.trim();

    if (!trimmedName || !input.baseRunId || !input.targetRunId) {
      return;
    }

    await updateComparisonState(
      {
        action: "save_snapshot",
        baseRunId: input.baseRunId,
        name: trimmedName,
        targetRunId: input.targetRunId,
      },
      {
        fallbackMessage: "Failed to save the comparison snapshot.",
        pendingLabel: "Saving comparison snapshot…",
        successMessage: "Comparison snapshot saved.",
      },
    );
  }

  async function handleSaveComparisonSnapshot() {
    const trimmedName = newComparisonSnapshotName.trim();

    if (!trimmedName) {
      return;
    }

    try {
      if (editingComparisonSnapshotId) {
        await updateComparisonState(
          {
            action: "rename_snapshot",
            name: trimmedName,
            snapshotId: editingComparisonSnapshotId,
          },
          {
            fallbackMessage: "Failed to rename the comparison snapshot.",
            pendingLabel: "Renaming comparison snapshot…",
            successMessage: "Comparison snapshot renamed.",
          },
        );
        setEditingComparisonSnapshotId(null);
        setNewComparisonSnapshotName("");
        return;
      }

      if (!comparisonBaseRunId || !comparisonTargetRunId) {
        return;
      }

      await upsertComparisonSnapshot({
        baseRunId: comparisonBaseRunId,
        name: trimmedName,
        targetRunId: comparisonTargetRunId,
      });
      setNewComparisonSnapshotName("");
    } catch {
      return;
    }
  }

  function handleApplyComparisonSnapshot(snapshotId: string) {
    const snapshot = comparisonSnapshots.find((entry) => entry.id === snapshotId);

    if (!snapshot) {
      return;
    }

    setComparisonBaseRunId(snapshot.baseRunId);
    setComparisonTargetRunId(snapshot.targetRunId);
  }

  function handleStartRenameComparisonSnapshot(snapshotId: string) {
    const snapshot = comparisonSnapshots.find((entry) => entry.id === snapshotId);

    if (!snapshot) {
      return;
    }

    setEditingComparisonSnapshotId(snapshotId);
    setNewComparisonSnapshotName(snapshot.name);
  }

  function handleCancelComparisonSnapshotEdit() {
    setEditingComparisonSnapshotId(null);
    setNewComparisonSnapshotName("");
  }

  async function handleTogglePinComparisonSnapshot(snapshotId: string) {
    try {
      await updateComparisonState(
        {
          action: "toggle_pin_snapshot",
          snapshotId,
        },
        {
          fallbackMessage: "Failed to update the comparison snapshot.",
          pendingLabel: "Updating comparison snapshot…",
          successMessage: "Comparison snapshot updated.",
        },
      );
    } catch {
      return;
    }
  }

  async function handleDeleteComparisonSnapshot(snapshotId: string) {
    try {
      await updateComparisonState(
        {
          action: "delete_snapshot",
          snapshotId,
        },
        {
          fallbackMessage: "Failed to delete the comparison snapshot.",
          pendingLabel: "Deleting comparison snapshot…",
          successMessage: "Comparison snapshot deleted.",
        },
      );
      if (editingComparisonSnapshotId === snapshotId) {
        handleCancelComparisonSnapshotEdit();
      }
    } catch {
      return;
    }
  }

  function handleApplyRecentComparison(entryId: string) {
    const entry = recentComparisons.find((item) => item.id === entryId);

    if (!entry) {
      return;
    }

    setComparisonBaseRunId(entry.baseRunId);
    setComparisonTargetRunId(entry.targetRunId);
  }

  async function handleSaveRecentComparisonAsSnapshot(entryId: string) {
    const entry = recentComparisons.find((item) => item.id === entryId);

    if (!entry) {
      return;
    }

    try {
      await upsertComparisonSnapshot({
        baseRunId: entry.baseRunId,
        name: `${entry.baseRunId} vs ${entry.targetRunId}`,
        targetRunId: entry.targetRunId,
      });
    } catch {
      return;
    }
  }

  async function handleDeleteRecentComparison(entryId: string) {
    try {
      await updateComparisonState(
        {
          action: "delete_recent",
          recentComparisonId: entryId,
        },
        {
          fallbackMessage: "Failed to delete the recent comparison.",
          pendingLabel: "Deleting recent comparison…",
          successMessage: "Recent comparison removed.",
        },
      );
    } catch {
      return;
    }
  }

  async function handleClearRecentComparisons() {
    try {
      await updateComparisonState(
        {
          action: "clear_recent",
        },
        {
          fallbackMessage: "Failed to clear recent comparisons.",
          pendingLabel: "Clearing recent comparisons…",
          successMessage: "Recent comparisons cleared.",
        },
      );
    } catch {
      return;
    }
  }

  async function handleCopyComparisonLink() {
    if (!comparisonBaseRunId || !comparisonTargetRunId || typeof window === "undefined") {
      setComparisonLinkStatus("failed");
      return;
    }

    const absoluteUrl = `${window.location.origin}${comparisonSharePath}`;

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable.");
      }

      await navigator.clipboard.writeText(absoluteUrl);
      setComparisonLinkStatus("copied");
    } catch {
      setComparisonLinkStatus("failed");
    }
  }

  function handleSwapComparisonRuns() {
    if (!comparisonBaseRunId || !comparisonTargetRunId) {
      return;
    }

    setComparisonBaseRunId(comparisonTargetRunId);
    setComparisonTargetRunId(comparisonBaseRunId);
  }

  function handleResetComparisonSelection() {
    const nextSelection = resolveInitialComparison({
      requestedBaseRunId: null,
      requestedTargetRunId: null,
      runs,
    });

    setComparisonBaseRunId(nextSelection.baseRunId);
    setComparisonTargetRunId(nextSelection.targetRunId);
    setComparisonLinkStatus(null);
  }

  function handleOpenComparisonRuns() {
    if (!comparisonBaseRunId || !comparisonTargetRunId || typeof window === "undefined") {
      return;
    }

    window.open(`/analysis/studies/${study.id}/runs/${comparisonBaseRunId}`, "_blank", "noopener,noreferrer");
    if (comparisonTargetRunId !== comparisonBaseRunId) {
      window.open(`/analysis/studies/${study.id}/runs/${comparisonTargetRunId}`, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <section className="analysis-page">
      <div className="analysis-hero">
        <p className="analysis-hero__eyebrow">Study detail</p>
        <h1 className="analysis-hero__title">{studyTitle}</h1>
        <p className="analysis-hero__copy">
          Status: {studyStatus}. Updated {formatTimestamp(studyUpdatedAt)}.
        </p>
        {currentQuestion ? (
          <p className="analysis-card__meta">
            Active question: {currentQuestion.questionText}
            {currentQuestion.proposedTreatmentLabel ? ` · suggested treatment ${currentQuestion.proposedTreatmentLabel}` : ""}
            {currentQuestion.proposedOutcomeLabel ? ` · suggested outcome ${currentQuestion.proposedOutcomeLabel}` : ""}
          </p>
        ) : null}
      </div>

      <div className="analysis-grid">
        <section className="analysis-card">
          <div className="analysis-card__header-row">
            <h2 className="analysis-card__title">Study summary</h2>
            <span className="analysis-card__meta">Autosave is local to this browser for DAG drafts.</span>
          </div>
          <form className="analysis-intake-form" onSubmit={handleSaveStudyMetadata}>
            <label className="analysis-intake-form__label" htmlFor="analysis-study-title">
              Study title
            </label>
            <input
              id="analysis-study-title"
              className="analysis-text-input"
              disabled={pending}
              onChange={(event) => setStudyTitle(event.target.value)}
              value={studyTitle}
            />
            <label className="analysis-intake-form__label" htmlFor="analysis-study-description">
              Study description
            </label>
            <textarea
              id="analysis-study-description"
              className="analysis-intake-form__textarea"
              disabled={pending}
              onChange={(event) => setStudyDescription(event.target.value)}
              rows={3}
              value={studyDescription}
            />
            <div className="analysis-intake-form__actions">
              <button className="analysis-intake-form__submit" disabled={pending} type="submit">
                {pending ? "Saving…" : "Save study summary"}
              </button>
            </div>
          </form>
          {currentQuestion ? (
            <ul className="analysis-list">
              <li>Question type: {currentQuestion.questionType}</li>
              <li>Question: {currentQuestion.questionText}</li>
              {currentQuestion.proposedTreatmentLabel ? (
                <li>Suggested treatment from intake: {currentQuestion.proposedTreatmentLabel}</li>
              ) : null}
              {currentQuestion.proposedOutcomeLabel ? (
                <li>Suggested outcome from intake: {currentQuestion.proposedOutcomeLabel}</li>
              ) : null}
            </ul>
          ) : (
            <p className="analysis-card__empty">No active question is attached to this study yet.</p>
          )}
        </section>

        <section className="analysis-card">
          <div className="analysis-card__header-row">
            <h2 className="analysis-card__title">Primary dataset binding</h2>
            <button className="analysis-inline-button" onClick={() => void refreshStudy(true)} type="button">
              Refresh
            </button>
          </div>
          <p className="analysis-card__copy">
            Pin exactly one active primary dataset version before DAG approval or run creation.
          </p>
          <form className="analysis-intake-form" onSubmit={handleBindPrimaryDataset}>
            <label className="analysis-intake-form__label" htmlFor="analysis-study-dataset">
              Dataset
            </label>
            <select
              id="analysis-study-dataset"
              className="analysis-select"
              disabled={pending}
              onChange={(event) => {
                const nextDatasetId = event.target.value;
                const nextDataset =
                  datasetBinding.catalog.find((dataset) => dataset.id === nextDatasetId) ?? null;
                setSelectedDatasetId(nextDatasetId);
                setSelectedDatasetVersionId(nextDataset?.versions[0]?.id ?? "");
              }}
              value={selectedDatasetId}
            >
              <option value="">Select a dataset</option>
              {datasetBinding.catalog.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.displayName} · {dataset.dataKind}
                </option>
              ))}
            </select>

            <label className="analysis-intake-form__label" htmlFor="analysis-study-dataset-version">
              Exact dataset version
            </label>
            <select
              id="analysis-study-dataset-version"
              className="analysis-select"
              disabled={pending || !selectedDataset}
              onChange={(event) => setSelectedDatasetVersionId(event.target.value)}
              value={selectedDatasetVersionId}
            >
              <option value="">Select a version</option>
              {selectedDataset?.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.versionNumber} · {version.ingestionStatus} · rows {version.rowCount ?? "?"}
                </option>
              ))}
            </select>

            <div className="analysis-intake-form__actions">
              <button className="analysis-intake-form__submit" disabled={pending} type="submit">
                {pending ? "Pinning…" : "Pin primary dataset"}
              </button>
              {error ? <p className="analysis-intake-form__error">{error}</p> : null}
            </div>
          </form>
        </section>

        <section className="analysis-card">
          <h2 className="analysis-card__title">Readiness gate</h2>
          <div className="analysis-readiness">
            <p className="analysis-card__meta">
              DAG approval: {datasetBinding.readiness.canApproveDag ? "ready" : "blocked"}
            </p>
            <p className="analysis-card__meta">
              Run creation: {datasetBinding.readiness.canCreateRun ? "ready" : "blocked"}
            </p>
            {datasetBinding.readiness.reasons.length ? (
              <ul className="analysis-list">
                {datasetBinding.readiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="analysis-card__meta">Primary dataset pinning requirements are satisfied.</p>
            )}
          </div>
        </section>
      </div>

      <div className="analysis-grid">
        <section className="analysis-card">
          <div className="analysis-card__header-row">
            <div>
              <h2 className="analysis-card__title">DAG workspace</h2>
              {dagDraft && draftGuardrails ? (
                <>
                  <p className="analysis-card__meta">
                    {draftGuardrails.errors.length > 0
                      ? `${draftGuardrails.errors.length} blocking issue${draftGuardrails.errors.length === 1 ? "" : "s"} found before approval.`
                      : "No blocking draft guardrails detected."}
                    {draftGuardrails.warnings.length > 0
                      ? ` ${draftGuardrails.warnings.length} warning${draftGuardrails.warnings.length === 1 ? "" : "s"} also flagged.`
                      : ""}
                  </p>
                  <p className="analysis-card__meta">
                    {dagWorkspace.currentVersion
                      ? hasUnsavedDagChanges
                        ? `Local draft changes are newer than saved version v${dagWorkspace.currentVersion.versionNumber}. Approval still applies only to the saved version until you save again.`
                        : `Local draft matches saved version v${dagWorkspace.currentVersion.versionNumber}.`
                      : hasUnsavedDagChanges
                        ? "This draft has local edits but no saved DAG version yet."
                        : "No saved DAG version yet."}
                  </p>
                </>
              ) : null}
            </div>
            <div className="analysis-inline-actions">
              <button className="analysis-inline-button" onClick={handleSeedDraftFromDataset} type="button">
                Seed from dataset
              </button>
              {dagDraft && draftGuardrails?.errors.length ? (
                <button className="analysis-inline-button" onClick={() => focusFirstDraftIssue("error")} type="button">
                  Review first blocking issue
                </button>
              ) : null}
              {dagDraft && !draftGuardrails?.errors.length && draftGuardrails?.warnings.length ? (
                <button className="analysis-inline-button" onClick={() => focusFirstDraftIssue("warning")} type="button">
                  Review first warning
                </button>
              ) : null}
              {dagDraft && (draftPathAssistance?.disconnectedNodeKeys.length ?? 0) > 0 ? (
                <button className="analysis-inline-button" onClick={focusFirstDisconnectedNode} type="button">
                  Review disconnected subgraph
                </button>
              ) : null}
              {dagWorkspace.currentVersion && hasUnsavedDagChanges ? (
                <button className="analysis-inline-button" onClick={resetDraftToSavedVersion} type="button">
                  Reset draft to saved version
                </button>
              ) : null}
              <button className="analysis-inline-button" disabled={pending || !dagDraft} onClick={() => void handleSaveDagVersion()} type="button">
                {dagDraft && (draftGuardrails?.errors.length ?? 0) > 0 ? "Save draft version" : "Save version"}
              </button>
            </div>
          </div>
          <p className="analysis-card__copy">
            Drafts are stored as graph JSON and normalized rows. Missing and unobserved variables
            must remain explicit.
          </p>
          {dagDraft ? (
            <div className="analysis-readiness">
              <p className="analysis-card__meta">
                Draft status: {hasUnsavedDagChanges ? "unsaved local changes" : "in sync with saved version"}
              </p>
              <p className="analysis-card__meta">
                {dagWorkspace.currentVersion
                  ? `Saved version available: v${dagWorkspace.currentVersion.versionNumber}.`
                  : "No DAG version has been saved yet."}
              </p>
            </div>
          ) : null}
          {error ? <p className="analysis-intake-form__error">{error}</p> : null}
          {dagDraft ? (
            <div className="analysis-editor-stack">
              <label className="analysis-intake-form__label" htmlFor="analysis-dag-title">
                DAG title
              </label>
              <input
                id="analysis-dag-title"
                className="analysis-text-input"
                onChange={(event) => setDagDraft({ ...dagDraft, title: event.target.value })}
                value={dagDraft.title}
              />

              <label className="analysis-intake-form__label" htmlFor="analysis-dag-description">
                DAG description
              </label>
              <textarea
                id="analysis-dag-description"
                className="analysis-intake-form__textarea"
                onChange={(event) => setDagDraft({ ...dagDraft, description: event.target.value })}
                rows={3}
                value={dagDraft.description}
              />

              <div ref={dagCanvasSectionRef} className="analysis-editor-section">
                <div className="analysis-card__header-row">
                  <h3 className="analysis-card__title">Graph canvas</h3>
                  <div className="analysis-inline-actions">
                    <button className="analysis-inline-button" onClick={autoArrangeDraftNodes} type="button">
                      Auto-arrange
                    </button>
                    <button
                      className="analysis-inline-button"
                      onClick={() => {
                        setSelectedNodeKey(null);
                        setSelectedEdgeKey(null);
                      }}
                      type="button"
                    >
                      Clear selection
                    </button>
                  </div>
                </div>
                <p className="analysis-card__meta">
                  Drag nodes to arrange the DAG, click a node or edge to inspect it, connect nodes visually to create edges,
                  and use the inline canvas controls to mark treatment/outcome roles or remove objects. Double-clicking an
                  edge still removes it, and Delete key removal is also supported inside the canvas.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {[
                    "treatment",
                    "outcome",
                    "confounder",
                    "mediator",
                    "instrument",
                    "latent",
                  ].map((nodeType) => (
                    <span
                      key={nodeType}
                      style={{
                        alignItems: "center",
                        background: "#ffffff",
                        border: `1px solid ${getNodeAccent(nodeType)}`,
                        borderRadius: 999,
                        color: getNodeAccent(nodeType),
                        display: "inline-flex",
                        fontSize: 12,
                        fontWeight: 600,
                        gap: 6,
                        padding: "4px 10px",
                      }}
                    >
                      <span
                        style={{
                          background: getNodeAccent(nodeType),
                          borderRadius: 999,
                          display: "inline-block",
                          height: 8,
                          width: 8,
                        }}
                      />
                      {nodeType}
                    </span>
                  ))}
                  <span
                    style={{
                      alignItems: "center",
                      background: "#eff6ff",
                      border: "1px solid #0284c7",
                      borderRadius: 999,
                      color: "#0369a1",
                      display: "inline-flex",
                      fontSize: 12,
                      fontWeight: 600,
                      gap: 6,
                      padding: "4px 10px",
                    }}
                  >
                    treatment→outcome path
                  </span>
                  <span
                    style={{
                      alignItems: "center",
                      background: "#f8fafc",
                      border: "1px dashed #64748b",
                      borderRadius: 999,
                      color: "#475569",
                      display: "inline-flex",
                      fontSize: 12,
                      fontWeight: 600,
                      gap: 6,
                      padding: "4px 10px",
                    }}
                  >
                    disconnected subgraph
                  </span>
                  <span
                    style={{
                      alignItems: "center",
                      background: "#fef2f2",
                      border: "1px solid #dc2626",
                      borderRadius: 999,
                      color: "#b91c1c",
                      display: "inline-flex",
                      fontSize: 12,
                      fontWeight: 600,
                      gap: 6,
                      padding: "4px 10px",
                    }}
                  >
                    blocking issue
                  </span>
                  <span
                    style={{
                      alignItems: "center",
                      background: "#fffbeb",
                      border: "1px solid #d97706",
                      borderRadius: 999,
                      color: "#b45309",
                      display: "inline-flex",
                      fontSize: 12,
                      fontWeight: 600,
                      gap: 6,
                      padding: "4px 10px",
                    }}
                  >
                    warning
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 16,
                    gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 340px)",
                  }}
                >
                  <AnalysisDagCanvas
                    disconnectedNodeKeys={draftPathAssistance?.disconnectedNodeKeys}
                    edges={dagDraft.edges}
                    errorEdgeKeys={errorEdgeKeys}
                    errorNodeKeys={errorNodeKeys}
                    nodeSuggestedEdgeActions={nodeSuggestedEdgeActions}
                    nodes={dagDraft.nodes}
                    pathEdgeKeys={draftPathAssistance?.pathEdgeKeys}
                    pathNodeKeys={draftPathAssistance?.pathNodeKeys}
                    onApplySuggestedEdge={applySuggestedBridge}
                    onConnectEdge={({ sourceNodeKey, targetNodeKey }) =>
                      connectDraftEdge({
                        relationshipLabel: newEdge.relationshipLabel,
                        sourceNodeKey,
                        targetNodeKey,
                      })
                    }
                    onMarkNodeAsOutcome={(nodeKey) => setExclusiveDraftNodeType(nodeKey, "outcome")}
                    onMarkNodeAsTreatment={(nodeKey) => setExclusiveDraftNodeType(nodeKey, "treatment")}
                    onRemoveEdge={removeDraftEdge}
                    onRemoveNode={removeDraftNode}
                    onSelectEdge={setSelectedEdgeKey}
                    onSelectNode={setSelectedNodeKey}
                    onUpdateEdgeLabel={({ edgeKey, relationshipLabel }) =>
                      updateDraftEdge(edgeKey, { relationshipLabel })
                    }
                    onUpdateNodePosition={updateDraftNodePosition}
                    positions={dagNodePositions}
                    selectedEdgeKey={selectedEdgeKey}
                    selectedNodeKey={selectedNodeKey}
                    warningEdgeKeys={warningEdgeKeys}
                    warningNodeKeys={warningNodeKeys}
                  />
                  <aside
                    style={{
                      background: "rgba(255, 255, 255, 0.9)",
                      border: "1px solid rgba(148, 163, 184, 0.25)",
                      borderRadius: 16,
                      display: "grid",
                      gap: 12,
                      padding: 16,
                    }}
                  >
                    {draftGuardrails?.errors.length ? (
                      <div
                        style={{
                          background: "#fef2f2",
                          border: "1px solid rgba(220, 38, 38, 0.22)",
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        <h4 className="analysis-card__title" style={{ color: "#b91c1c", fontSize: 15 }}>
                          Blocking guardrails
                        </h4>
                        <ul className="analysis-list" style={{ color: "#991b1b", marginTop: 8 }}>
                          {draftGuardrails.errors.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {draftGuardrails?.warnings.length ? (
                      <div
                        style={{
                          background: "#fffbeb",
                          border: "1px solid rgba(217, 119, 6, 0.22)",
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        <h4 className="analysis-card__title" style={{ color: "#b45309", fontSize: 15 }}>
                          Draft warnings
                        </h4>
                        <ul className="analysis-list" style={{ color: "#92400e", marginTop: 8 }}>
                          {draftGuardrails.warnings.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {draftPathAssistance ? (
                      <div
                        style={{
                          background: "#eff6ff",
                          border: "1px solid rgba(2, 132, 199, 0.2)",
                          borderRadius: 12,
                          padding: 12,
                        }}
                      >
                        <h4 className="analysis-card__title" style={{ color: "#0369a1", fontSize: 15 }}>
                          Path assistance
                        </h4>
                        <p className="analysis-card__meta" style={{ marginTop: 8 }}>
                          {draftPathAssistance.treatmentNodeKey && draftPathAssistance.outcomeNodeKey
                            ? draftPathAssistance.pathExists
                              ? `Highlighted path: ${draftPathAssistance.pathNodeKeys.join(" → ")}`
                              : `No directed path yet from ${draftPathAssistance.treatmentNodeKey} to ${draftPathAssistance.outcomeNodeKey}.`
                            : "Pick exactly one treatment and one outcome to enable path assistance."}
                        </p>
                        <p className="analysis-card__meta">
                          {draftPathAssistance.disconnectedNodeKeys.length > 0
                            ? `${draftPathAssistance.disconnectedNodeKeys.length} node${draftPathAssistance.disconnectedNodeKeys.length === 1 ? " is" : "s are"} disconnected from the study question.`
                            : "No disconnected subgraphs detected around the study question."}
                        </p>
                        {draftPathAssistance.suggestions.length ? (
                          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                            {draftPathAssistance.suggestions.map((suggestion) => {
                              const suggestionKey = `${suggestion.sourceNodeKey ?? "none"}-${suggestion.targetNodeKey ?? "none"}-${suggestion.message}`;
                              const canApply = Boolean(suggestion.sourceNodeKey && suggestion.targetNodeKey);

                              return (
                                <div
                                  key={suggestionKey}
                                  style={{
                                    background: "rgba(255, 255, 255, 0.75)",
                                    border: "1px solid rgba(2, 132, 199, 0.14)",
                                    borderRadius: 12,
                                    padding: 10,
                                  }}
                                >
                                  <p className="analysis-card__meta" style={{ margin: 0 }}>
                                    {suggestion.message}
                                  </p>
                                  <div className="analysis-inline-actions" style={{ marginTop: 8 }}>
                                    {canApply ? (
                                      <button
                                        className="analysis-inline-button"
                                        onClick={() =>
                                          applySuggestedBridge({
                                            sourceNodeKey: suggestion.sourceNodeKey,
                                            targetNodeKey: suggestion.targetNodeKey,
                                          })
                                        }
                                        type="button"
                                      >
                                        Apply suggested edge
                                      </button>
                                    ) : null}
                                    {suggestion.sourceNodeKey ? (
                                      <button
                                        className="analysis-inline-button"
                                        onClick={() => focusNode(suggestion.sourceNodeKey ?? null)}
                                        type="button"
                                      >
                                        Focus source
                                      </button>
                                    ) : null}
                                    {suggestion.targetNodeKey ? (
                                      <button
                                        className="analysis-inline-button"
                                        onClick={() => focusNode(suggestion.targetNodeKey ?? null)}
                                        type="button"
                                      >
                                        Focus target
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {(draftPathAssistance.pathExists || draftPathAssistance.disconnectedNodeKeys.length > 0) ? (
                          <div className="analysis-inline-actions" style={{ marginTop: 8 }}>
                            {draftPathAssistance.pathExists ? (
                              <button
                                className="analysis-inline-button"
                                onClick={() => focusNode(draftPathAssistance.pathNodeKeys[0] ?? null)}
                                type="button"
                              >
                                Focus highlighted path
                              </button>
                            ) : null}
                            {draftPathAssistance.disconnectedNodeKeys.length > 0 ? (
                              <button className="analysis-inline-button" onClick={focusFirstDisconnectedNode} type="button">
                                Focus disconnected subgraph
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div>
                      <h4 className="analysis-card__title" style={{ fontSize: 16 }}>
                        Draft status
                      </h4>
                      <p className="analysis-card__meta">
                        {dagDraft.nodes.length} nodes · {dagDraft.edges.length} edges · {dagDraft.assumptions.length} assumptions
                      </p>
                      <p className="analysis-card__meta">
                        {draftGuardrails?.errors.length ?? 0} blocking issues · {draftGuardrails?.warnings.length ?? 0} warnings
                      </p>
                      <p className="analysis-card__meta">
                        Treatment: {treatmentNodes.length === 1 ? treatmentNodes[0]?.nodeKey : `${treatmentNodes.length} selected`}
                      </p>
                      <p className="analysis-card__meta">
                        Outcome: {outcomeNodes.length === 1 ? outcomeNodes[0]?.nodeKey : `${outcomeNodes.length} selected`}
                      </p>
                      {treatmentNodes.length !== 1 || outcomeNodes.length !== 1 ? (
                        <p className="analysis-intake-form__error">
                          Exactly one treatment node and one outcome node are required before approval.
                        </p>
                      ) : null}
                    </div>

                    {selectedDraftNode ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <div className="analysis-card__header-row">
                          <h4 className="analysis-card__title" style={{ fontSize: 16 }}>
                            Selected node
                          </h4>
                          <span className="analysis-card__meta">{selectedDraftNode.nodeKey}</span>
                        </div>
                        <input
                          className="analysis-text-input"
                          onChange={(event) => updateDraftNode(selectedDraftNode.nodeKey, { label: event.target.value })}
                          value={selectedDraftNode.label}
                        />
                        <select
                          className="analysis-select"
                          onChange={(event) =>
                            updateDraftNode(selectedDraftNode.nodeKey, { nodeType: event.target.value })
                          }
                          value={selectedDraftNode.nodeType}
                        >
                          {ANALYSIS_DAG_NODE_TYPE_VALUES.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <select
                          className="analysis-select"
                          onChange={(event) =>
                            updateDraftNode(selectedDraftNode.nodeKey, { observedStatus: event.target.value })
                          }
                          value={selectedDraftNode.observedStatus}
                        >
                          {ANALYSIS_DAG_NODE_OBSERVED_STATUS_VALUES.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <textarea
                          className="analysis-intake-form__textarea"
                          onChange={(event) =>
                            updateDraftNode(selectedDraftNode.nodeKey, { description: event.target.value })
                          }
                          placeholder="Optional note about why this node belongs in the DAG"
                          rows={3}
                          value={selectedDraftNode.description}
                        />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <button
                            className="analysis-inline-button"
                            onClick={() => setExclusiveDraftNodeType(selectedDraftNode.nodeKey, "treatment")}
                            type="button"
                          >
                            Mark as treatment
                          </button>
                          <button
                            className="analysis-inline-button"
                            onClick={() => setExclusiveDraftNodeType(selectedDraftNode.nodeKey, "outcome")}
                            type="button"
                          >
                            Mark as outcome
                          </button>
                          <button
                            className="analysis-inline-button"
                            onClick={() => removeDraftNode(selectedDraftNode.nodeKey)}
                            type="button"
                          >
                            Remove node
                          </button>
                        </div>
                        <p className="analysis-card__meta">
                          Source: {selectedDraftNode.sourceType}
                          {selectedDraftNode.datasetColumnId ? ` · dataset column ${selectedDraftNode.datasetColumnId}` : ""}
                        </p>
                        {draftPathAssistance?.pathNodeKeys.includes(selectedDraftNode.nodeKey) ? (
                          <p className="analysis-card__meta">This node sits on the current highlighted treatment→outcome path.</p>
                        ) : null}
                        {draftPathAssistance?.disconnectedNodeKeys.includes(selectedDraftNode.nodeKey) ? (
                          <p className="analysis-card__meta">This node is currently disconnected from the main study-question subgraph.</p>
                        ) : null}
                        {(nodeSuggestedEdgeActions[selectedDraftNode.nodeKey]?.length ?? 0) > 0 ? (
                          <div style={{ display: "grid", gap: 6 }}>
                            <strong style={{ fontSize: 13 }}>Quick-add suggested links</strong>
                            <div className="analysis-inline-actions">
                              {nodeSuggestedEdgeActions[selectedDraftNode.nodeKey]?.slice(0, 3).map((action) => (
                                <button
                                  key={action.actionKey}
                                  className="analysis-inline-button"
                                  onClick={() =>
                                    applySuggestedBridge({
                                      sourceNodeKey: action.sourceNodeKey,
                                      targetNodeKey: action.targetNodeKey,
                                    })
                                  }
                                  type="button"
                                >
                                  {action.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {(draftGuardrails?.nodeIssues[selectedDraftNode.nodeKey]?.length ?? 0) > 0 ? (
                          <div
                            style={{
                              background: draftGuardrails?.nodeIssues[selectedDraftNode.nodeKey]?.some((issue) => issue.severity === "error")
                                ? "#fef2f2"
                                : "#fffbeb",
                              border: draftGuardrails?.nodeIssues[selectedDraftNode.nodeKey]?.some((issue) => issue.severity === "error")
                                ? "1px solid rgba(220, 38, 38, 0.22)"
                                : "1px solid rgba(217, 119, 6, 0.22)",
                              borderRadius: 12,
                              padding: 10,
                            }}
                          >
                            <strong style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Node issues</strong>
                            <ul className="analysis-list" style={{ margin: 0 }}>
                              {draftGuardrails?.nodeIssues[selectedDraftNode.nodeKey]?.map((issue) => (
                                <li key={`${issue.severity}-${issue.message}`}>{issue.message}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : selectedDraftEdge ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <div className="analysis-card__header-row">
                          <h4 className="analysis-card__title" style={{ fontSize: 16 }}>
                            Selected edge
                          </h4>
                          <span className="analysis-card__meta">{selectedDraftEdge.sourceNodeKey} → {selectedDraftEdge.targetNodeKey}</span>
                        </div>
                        <input
                          className="analysis-text-input"
                          onChange={(event) =>
                            updateDraftEdge(selectedDraftEdge.edgeKey, { relationshipLabel: event.target.value })
                          }
                          value={selectedDraftEdge.relationshipLabel}
                        />
                        <textarea
                          className="analysis-intake-form__textarea"
                          onChange={(event) => updateDraftEdge(selectedDraftEdge.edgeKey, { note: event.target.value })}
                          placeholder="Optional note about the assumed relationship"
                          rows={3}
                          value={selectedDraftEdge.note}
                        />
                        <button
                          className="analysis-inline-button"
                          onClick={() => removeDraftEdge(selectedDraftEdge.edgeKey)}
                          type="button"
                        >
                          Remove edge
                        </button>
                        {draftPathAssistance?.pathEdgeKeys.includes(selectedDraftEdge.edgeKey) ? (
                          <p className="analysis-card__meta">This edge is part of the current highlighted treatment→outcome path.</p>
                        ) : null}
                        {(draftGuardrails?.edgeIssues[selectedDraftEdge.edgeKey]?.length ?? 0) > 0 ? (
                          <div
                            style={{
                              background: draftGuardrails?.edgeIssues[selectedDraftEdge.edgeKey]?.some((issue) => issue.severity === "error")
                                ? "#fef2f2"
                                : "#fffbeb",
                              border: draftGuardrails?.edgeIssues[selectedDraftEdge.edgeKey]?.some((issue) => issue.severity === "error")
                                ? "1px solid rgba(220, 38, 38, 0.22)"
                                : "1px solid rgba(217, 119, 6, 0.22)",
                              borderRadius: 12,
                              padding: 10,
                            }}
                          >
                            <strong style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Edge issues</strong>
                            <ul className="analysis-list" style={{ margin: 0 }}>
                              {draftGuardrails?.edgeIssues[selectedDraftEdge.edgeKey]?.map((issue) => (
                                <li key={`${issue.severity}-${issue.message}`}>{issue.message}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        <h4 className="analysis-card__title" style={{ fontSize: 16 }}>
                          Canvas inspector
                        </h4>
                        <p className="analysis-card__meta">
                          Click a node to edit its role, status, and notes. Click an edge to edit the relationship label.
                        </p>
                        <label className="analysis-intake-form__label" htmlFor="analysis-default-edge-label">
                          Default visual edge label
                        </label>
                        <input
                          id="analysis-default-edge-label"
                          className="analysis-text-input"
                          onChange={(event) =>
                            setNewEdge({
                              ...newEdge,
                              relationshipLabel: event.target.value,
                            })
                          }
                          value={newEdge.relationshipLabel}
                        />
                        <p className="analysis-card__meta">
                          New canvas connections will use this label until you change it.
                        </p>
                      </div>
                    )}
                  </aside>
                </div>
              </div>

              <div className="analysis-editor-section">
                <h3 className="analysis-card__title">Nodes</h3>
                <div className="analysis-table">
                  {dagDraft.nodes.map((node) => (
                    <div
                      key={node.nodeKey}
                      className="analysis-table__row"
                      style={{
                        borderRadius: 12,
                        outline:
                          selectedNodeKey === node.nodeKey ? `2px solid ${getNodeAccent(node.nodeType)}` : undefined,
                        padding: selectedNodeKey === node.nodeKey ? 6 : undefined,
                      }}
                    >
                      <input
                        className="analysis-text-input"
                        onChange={(event) => updateDraftNode(node.nodeKey, { label: event.target.value })}
                        onFocus={() => {
                          setSelectedNodeKey(node.nodeKey);
                          setSelectedEdgeKey(null);
                        }}
                        value={node.label}
                      />
                      <select
                        className="analysis-select"
                        onChange={(event) => updateDraftNode(node.nodeKey, { nodeType: event.target.value })}
                        onFocus={() => {
                          setSelectedNodeKey(node.nodeKey);
                          setSelectedEdgeKey(null);
                        }}
                        value={node.nodeType}
                      >
                        {ANALYSIS_DAG_NODE_TYPE_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <select
                        className="analysis-select"
                        onChange={(event) => updateDraftNode(node.nodeKey, { observedStatus: event.target.value })}
                        onFocus={() => {
                          setSelectedNodeKey(node.nodeKey);
                          setSelectedEdgeKey(null);
                        }}
                        value={node.observedStatus}
                      >
                        {ANALYSIS_DAG_NODE_OBSERVED_STATUS_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <button
                        className="analysis-inline-button"
                        onClick={() => {
                          setSelectedNodeKey(node.nodeKey);
                          setSelectedEdgeKey(null);
                          removeDraftNode(node.nodeKey);
                        }}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="analysis-inline-form">
                  <input
                    className="analysis-text-input"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, nodeKey: event.target.value })}
                    placeholder="missing_confounder"
                    value={newCustomNode.nodeKey}
                  />
                  <input
                    className="analysis-text-input"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, label: event.target.value })}
                    placeholder="Missing confounder"
                    value={newCustomNode.label}
                  />
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, nodeType: event.target.value })}
                    value={newCustomNode.nodeType}
                  >
                    {ANALYSIS_DAG_NODE_TYPE_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, observedStatus: event.target.value })}
                    value={newCustomNode.observedStatus}
                  >
                    {ANALYSIS_DAG_NODE_OBSERVED_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <button className="analysis-inline-button" onClick={addCustomNode} type="button">
                    Add node
                  </button>
                </div>
              </div>

              <div className="analysis-editor-section">
                <h3 className="analysis-card__title">Edges</h3>
                <div className="analysis-table">
                  {dagDraft.edges.map((edge) => (
                    <div
                      key={edge.edgeKey}
                      className="analysis-table__row"
                      style={{
                        borderRadius: 12,
                        outline: selectedEdgeKey === edge.edgeKey ? "2px solid #2563eb" : undefined,
                        padding: selectedEdgeKey === edge.edgeKey ? 6 : undefined,
                      }}
                    >
                      <span className="analysis-table__label">
                        {edge.sourceNodeKey} → {edge.targetNodeKey}
                      </span>
                      <input
                        className="analysis-text-input"
                        onChange={(event) => updateDraftEdge(edge.edgeKey, { relationshipLabel: event.target.value })}
                        onFocus={() => {
                          setSelectedEdgeKey(edge.edgeKey);
                          setSelectedNodeKey(null);
                        }}
                        value={edge.relationshipLabel}
                      />
                      <button
                        className="analysis-inline-button"
                        onClick={() => {
                          setSelectedEdgeKey(edge.edgeKey);
                          setSelectedNodeKey(null);
                          removeDraftEdge(edge.edgeKey);
                        }}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="analysis-inline-form">
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewEdge({ ...newEdge, sourceNodeKey: event.target.value })}
                    value={newEdge.sourceNodeKey}
                  >
                    <option value="">Source node</option>
                    {sortedNodeOptions.map((node) => (
                      <option key={node.nodeKey} value={node.nodeKey}>
                        {node.nodeKey}
                      </option>
                    ))}
                  </select>
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewEdge({ ...newEdge, targetNodeKey: event.target.value })}
                    value={newEdge.targetNodeKey}
                  >
                    <option value="">Target node</option>
                    {sortedNodeOptions.map((node) => (
                      <option key={node.nodeKey} value={node.nodeKey}>
                        {node.nodeKey}
                      </option>
                    ))}
                  </select>
                  <input
                    className="analysis-text-input"
                    onChange={(event) => setNewEdge({ ...newEdge, relationshipLabel: event.target.value })}
                    placeholder="causes"
                    value={newEdge.relationshipLabel}
                  />
                  <button className="analysis-inline-button" onClick={addEdge} type="button">
                    Add edge
                  </button>
                </div>
              </div>

              <div className="analysis-editor-section">
                <h3 className="analysis-card__title">Assumptions</h3>
                <ul className="analysis-list">
                  {dagDraft.assumptions.map((assumption, index) => (
                    <li key={`${assumption.description}-${index}`}>
                      {assumption.assumptionType}: {assumption.description}
                    </li>
                  ))}
                </ul>
                <div className="analysis-inline-form">
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewAssumption({ ...newAssumption, assumptionType: event.target.value })}
                    value={newAssumption.assumptionType}
                  >
                    {ANALYSIS_ASSUMPTION_TYPE_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewAssumption({ ...newAssumption, status: event.target.value })}
                    value={newAssumption.status}
                  >
                    {ANALYSIS_ASSUMPTION_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewAssumption({ ...newAssumption, relatedNodeKey: event.target.value })}
                    value={newAssumption.relatedNodeKey}
                  >
                    <option value="">Related node</option>
                    {sortedNodeOptions.map((node) => (
                      <option key={node.nodeKey} value={node.nodeKey}>
                        {node.nodeKey}
                      </option>
                    ))}
                  </select>
                  <input
                    className="analysis-text-input"
                    onChange={(event) => setNewAssumption({ ...newAssumption, description: event.target.value })}
                    placeholder="Describe the assumption"
                    value={newAssumption.description}
                  />
                  <button className="analysis-inline-button" onClick={addAssumption} type="button">
                    Add assumption
                  </button>
                </div>
              </div>

              <div className="analysis-editor-section">
                <h3 className="analysis-card__title">Missing data requirements</h3>
                <ul className="analysis-list">
                  {dagDraft.dataRequirements.map((requirement, index) => (
                    <li key={`${requirement.variableLabel}-${index}`}>
                      {requirement.variableLabel}: {requirement.reasonNeeded}
                    </li>
                  ))}
                </ul>
                <div className="analysis-inline-form">
                  <input
                    className="analysis-text-input"
                    onChange={(event) =>
                      setNewDataRequirement({ ...newDataRequirement, variableLabel: event.target.value })
                    }
                    placeholder="Variable label"
                    value={newDataRequirement.variableLabel}
                  />
                  <input
                    className="analysis-text-input"
                    onChange={(event) =>
                      setNewDataRequirement({ ...newDataRequirement, reasonNeeded: event.target.value })
                    }
                    placeholder="Why is it needed?"
                    value={newDataRequirement.reasonNeeded}
                  />
                  <select
                    className="analysis-select"
                    onChange={(event) => setNewDataRequirement({ ...newDataRequirement, status: event.target.value })}
                    value={newDataRequirement.status}
                  >
                    {ANALYSIS_DATA_REQUIREMENT_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="analysis-select"
                    onChange={(event) =>
                      setNewDataRequirement({ ...newDataRequirement, relatedNodeKey: event.target.value })
                    }
                    value={newDataRequirement.relatedNodeKey}
                  >
                    <option value="">Related node</option>
                    {sortedNodeOptions.map((node) => (
                      <option key={node.nodeKey} value={node.nodeKey}>
                        {node.nodeKey}
                      </option>
                    ))}
                  </select>
                  <button className="analysis-inline-button" onClick={addDataRequirement} type="button">
                    Add requirement
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="analysis-card__empty">
              Pin a primary dataset version, then seed or build a DAG draft.
            </p>
          )}
        </section>

        <section className="analysis-card">
          <h2 className="analysis-card__title">Approval and version history</h2>
          {dagWorkspace.currentVersion ? (
            <>
              <p className="analysis-card__copy">
                Current version v{dagWorkspace.currentVersion.versionNumber}
                {dagWorkspace.currentVersion.treatmentNodeKey
                  ? ` · treatment ${dagWorkspace.currentVersion.treatmentNodeKey}`
                  : ""}
                {dagWorkspace.currentVersion.outcomeNodeKey
                  ? ` · outcome ${dagWorkspace.currentVersion.outcomeNodeKey}`
                  : ""}
              </p>
              <div className="analysis-readiness">
                {dagWorkspace.currentVersion.validation.errors.length ? (
                  <>
                    <ul className="analysis-list">
                      {dagWorkspace.currentVersion.validation.errors.map((errorMessage) => (
                        <li key={errorMessage}>{errorMessage}</li>
                      ))}
                    </ul>
                    <button className="analysis-inline-button" onClick={() => focusFirstDraftIssue("error")} type="button">
                      Review first blocking issue in canvas
                    </button>
                  </>
                ) : (
                  <p className="analysis-card__meta">Current version passes stored validation checks.</p>
                )}
                {hasUnsavedDagChanges ? (
                  <div
                    style={{
                      background: "#eff6ff",
                      border: "1px solid rgba(37, 99, 235, 0.2)",
                      borderRadius: 12,
                      marginTop: 8,
                      padding: 12,
                    }}
                  >
                    <p className="analysis-card__meta" style={{ color: "#1d4ed8" }}>
                      Local draft edits are not part of saved version v{dagWorkspace.currentVersion.versionNumber} yet.
                      Save a new version or reset the draft before approval.
                    </p>
                    <div className="analysis-inline-actions" style={{ marginTop: 8 }}>
                      <button className="analysis-inline-button" onClick={() => void handleSaveDagVersion()} type="button">
                        Save a new DAG version first
                      </button>
                      <button className="analysis-inline-button" onClick={resetDraftToSavedVersion} type="button">
                        Reset draft to saved version
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <label className="analysis-intake-form__label" htmlFor="analysis-approval-text">
                Approval statement
              </label>
              <textarea
                id="analysis-approval-text"
                className="analysis-intake-form__textarea"
                onChange={(event) => setApprovalText(event.target.value)}
                rows={4}
                value={approvalText}
              />
              <button
                className="analysis-intake-form__submit"
                disabled={pending || dagWorkspace.currentVersion.validation.errors.length > 0 || hasUnsavedDagChanges}
                onClick={() => void handleApproveDagVersion()}
                type="button"
              >
                {pending ? "Approving…" : "Approve current DAG version"}
              </button>
              {dagWorkspace.currentVersion.validation.errors.length ? (
                <p className="analysis-card__meta">
                  Approval is disabled until the saved DAG version has no blocking validation errors.
                </p>
              ) : null}
              {hasUnsavedDagChanges ? (
                <p className="analysis-card__meta">
                  Approval is also disabled while the local draft differs from the saved DAG version.
                </p>
              ) : null}
            </>
          ) : (
            <p className="analysis-card__empty">No DAG version saved yet.</p>
          )}

          {dagWorkspace.dag?.versions.length ? (
            <ul className="analysis-study-list">
              {dagWorkspace.dag.versions.map((version) => (
                <li key={version.id} className="analysis-study-list__item">
                  <div className="analysis-study-list__header">
                    <strong>Version {version.versionNumber}</strong>
                    <span className="analysis-study-list__status">
                      {version.validation.errors.length ? "draft" : "valid"}
                    </span>
                  </div>
                  <p className="analysis-study-list__meta">Saved {formatTimestamp(version.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {dagWorkspace.approvals.length ? (
            <div className="analysis-approval-list">
              <h3 className="analysis-card__title">Approvals</h3>
              <ul className="analysis-list">
                {dagWorkspace.approvals.map((approval) => (
                  <li key={approval.id}>
                    {approval.approvalKind} · {formatTimestamp(approval.createdAt)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      <div className="analysis-grid">
        <section className="analysis-card">
          <h2 className="analysis-card__title">Current bindings</h2>
          {datasetBinding.bindings.length ? (
            <ul className="analysis-study-list">
              {datasetBinding.bindings.map((binding) => (
                <li key={binding.id} className="analysis-study-list__item">
                  <div className="analysis-study-list__header">
                    <strong>{binding.dataset.displayName}</strong>
                    <span className="analysis-study-list__status">
                      {binding.bindingRole} · {binding.isActive ? "active" : "inactive"}
                    </span>
                  </div>
                  <p className="analysis-study-list__question">
                    {binding.datasetVersion
                      ? `Pinned to version ${binding.datasetVersion.versionNumber}`
                      : "No exact version pinned yet."}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-card__empty">No dataset bindings yet.</p>
          )}
        </section>

        <section className="analysis-card">
          <h2 className="analysis-card__title">DAG seeding contract</h2>
          {datasetBinding.seedContract ? (
            <>
              <p className="analysis-card__copy">
                Seed from {datasetBinding.seedContract.dataset.displayName} v
                {datasetBinding.seedContract.datasetVersion.versionNumber}.
              </p>
              <ul className="analysis-column-list">
                {datasetBinding.seedContract.columns.map((column) => (
                  <li key={column.id} className="analysis-column-list__item">
                    <strong>{column.displayName}</strong>
                    <span>
                      {column.columnName} · {column.physicalType} · {column.semanticType}
                      {column.nullable ? " · nullable" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="analysis-card__empty">
              Pin a primary dataset version to expose dataset-backed columns for DAG seeding.
            </p>
          )}
        </section>

        <section className="analysis-card">
          <div className="analysis-card__header-row">
            <div>
              <h2 className="analysis-card__title">Analysis runs</h2>
              <p className="analysis-card__meta">{runs.length} stored run{runs.length === 1 ? "" : "s"}</p>
            </div>
            <button
              className="analysis-intake-form__submit"
              disabled={pending || !datasetBinding.readiness.canCreateRun || !dagWorkspace.approvals.length}
              onClick={() => void handleCreateRun()}
              type="button"
            >
              {pending ? "Running…" : "Create analysis run"}
            </button>
          </div>
          <p className="analysis-card__copy">
            Runs are pinned to the approved DAG version and primary dataset version. If identification
            fails, the result remains honestly not identifiable.
          </p>
          {runs.length ? (
            <AnalysisRunHighlights
              comparisonBaseRunId={comparisonBaseRunId}
              comparisonTargetRunId={comparisonTargetRunId}
              formatLabel={formatLabel}
              formatNumber={formatNumber}
              formatPreviewList={formatPreviewList}
              formatTimestamp={formatTimestamp}
              onCompareAgainstHighlight={compareAgainstHighlight}
              onSetComparisonBaseline={setComparisonBaseline}
              runHighlights={runHighlights}
              runsLength={runs.length}
              studyId={study.id}
            />
          ) : null}
          <AnalysisComparisonWorkspace
            bestSupportedIdentifiedRun={bestSupportedIdentifiedRun}
            comparisonAdjustmentDiff={comparisonAdjustmentDiff}
            comparisonBaseRun={comparisonBaseRun}
            comparisonBaseRunId={comparisonBaseRunId}
            comparisonBlockingReasonDiff={comparisonBlockingReasonDiff}
            comparisonError={comparisonError}
            comparisonEstimandDiff={comparisonEstimandDiff}
            comparisonLastSyncedAt={comparisonLastSyncedAt}
            comparisonLinkStatus={comparisonLinkStatus}
            comparisonPending={comparisonPending}
            comparisonPendingAction={comparisonPendingAction}
            comparisonRefuterDiff={comparisonRefuterDiff}
            comparisonSnapshots={comparisonSnapshotsWithAvailability}
            comparisonSuccessMessage={comparisonSuccessMessage}
            comparisonTargetRun={comparisonTargetRun}
            comparisonTargetRunId={comparisonTargetRunId}
            editingComparisonSnapshotId={editingComparisonSnapshotId}
            formatComparisonPairLabel={formatComparisonPairLabel}
            formatLabel={formatLabel}
            formatNumber={formatNumber}
            formatPreviewList={formatPreviewList}
            formatTimestamp={formatTimestamp}
            latestAnswerBearingRun={latestAnswerBearingRun}
            latestCompletedRun={latestCompletedRun}
            latestRun={latestRun}
            newComparisonSnapshotName={newComparisonSnapshotName}
            onApplyComparisonSnapshot={handleApplyComparisonSnapshot}
            onApplyRecentComparison={handleApplyRecentComparison}
            onCancelComparisonSnapshotEdit={handleCancelComparisonSnapshotEdit}
            onClearRecentComparisons={() => void handleClearRecentComparisons()}
            onCopyComparisonLink={() => void handleCopyComparisonLink()}
            onDeleteComparisonSnapshot={(snapshotId) => void handleDeleteComparisonSnapshot(snapshotId)}
            onDeleteRecentComparison={(entryId) => void handleDeleteRecentComparison(entryId)}
            onLoadSnapshotIntoEditor={(snapshot) => {
              setComparisonBaseRunId(snapshot.baseRunId);
              setComparisonTargetRunId(snapshot.targetRunId);
              setNewComparisonSnapshotName(snapshot.name);
              setEditingComparisonSnapshotId(null);
            }}
            onNewComparisonSnapshotNameChange={setNewComparisonSnapshotName}
            onOpenComparisonRuns={handleOpenComparisonRuns}
            onResetComparisonSelection={handleResetComparisonSelection}
            onSaveComparisonSnapshot={() => void handleSaveComparisonSnapshot()}
            onSaveRecentComparisonAsSnapshot={(entryId) => void handleSaveRecentComparisonAsSnapshot(entryId)}
            onSetComparisonBaseline={setComparisonBaseline}
            onSetComparisonPair={(baseRunId, targetRunId) => {
              setComparisonBaseRunId(baseRunId);
              setComparisonTargetRunId(targetRunId);
            }}
            onSetComparisonTarget={setComparisonTarget}
            onStartRenameComparisonSnapshot={handleStartRenameComparisonSnapshot}
            onSuggestSnapshotName={setNewComparisonSnapshotName}
            onSwapComparisonRuns={handleSwapComparisonRuns}
            onTogglePinComparisonSnapshot={(snapshotId) => void handleTogglePinComparisonSnapshot(snapshotId)}
            recentComparisons={recentComparisonsWithAvailability}
            runs={runs}
            studyId={study.id}
          />
          {runs.length ? (
            <ul className="analysis-study-list">
              {runs.map((run) => (
                <li key={run.id} className="analysis-study-list__item">
                  <div className="analysis-study-list__header">
                    <strong>
                      <Link className="analysis-study-list__link" href={`/analysis/studies/${study.id}/runs/${run.id}`}>
                        {run.id}
                      </Link>
                    </strong>
                    <span className="analysis-study-list__status">{run.status}</span>
                  </div>
                  {runBadgesByRunId.get(run.id)?.length ? (
                    <div className="analysis-inline-actions" style={{ marginTop: 8, rowGap: 8 }}>
                      {runBadgesByRunId.get(run.id)!.map((badge) => (
                        <span
                          key={badge}
                          className="analysis-card__meta"
                          style={{
                            background:
                              badge === "Current baseline"
                                ? "#eff6ff"
                                : badge === "Current comparison"
                                  ? "#f5f3ff"
                                  : "#f8fafc",
                            border:
                              badge === "Current baseline"
                                ? "1px solid rgba(37, 99, 235, 0.18)"
                                : badge === "Current comparison"
                                  ? "1px solid rgba(109, 40, 217, 0.18)"
                                  : "1px solid rgba(148, 163, 184, 0.22)",
                            borderRadius: 999,
                            color:
                              badge === "Current baseline"
                                ? "#1d4ed8"
                                : badge === "Current comparison"
                                  ? "#6d28d9"
                                  : "#475569",
                            display: "inline-flex",
                            fontWeight: 600,
                            padding: "4px 10px",
                          }}
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="analysis-study-list__meta">
                    Started {formatTimestamp(run.createdAt)}
                    {run.completedAt ? ` · completed ${formatTimestamp(run.completedAt)}` : ""}
                  </p>
                  <p className="analysis-study-list__meta">
                    {run.identified == null ? "Identification pending" : run.identified ? "Identified" : "Not identified"}
                    {run.identificationMethod ? ` · ${formatLabel(run.identificationMethod)}` : ""}
                    {run.primaryEstimateValue != null ? ` · estimate ${formatNumber(run.primaryEstimateValue)}` : ""}
                  </p>
                  <p className="analysis-study-list__meta">
                    {run.adjustmentSet.length ? `Adjustment set: ${run.adjustmentSet.join(", ")}` : "No stored adjustment set"}
                    {run.blockingReasons.length ? ` · blocking reasons ${run.blockingReasons.length}` : ""}
                  </p>
                  <p className="analysis-study-list__meta">
                    {run.refutationCount} refutations · {run.answerCount} answers · {run.artifactCount} artifacts
                  </p>
                  <div className="analysis-inline-actions" style={{ marginTop: 8, rowGap: 8 }}>
                    <a className="analysis-study-list__link" href={`/api/analysis/runs/${run.id}/export`}>
                      Download export bundle
                    </a>
                    {runs.length >= 2 ? (
                      <>
                        <button
                          className="analysis-inline-button"
                          onClick={() => setComparisonBaseline(run.id)}
                          type="button"
                        >
                          {comparisonBaseRunId === run.id ? "Baseline selected" : "Set as baseline"}
                        </button>
                        <button
                          className="analysis-inline-button"
                          onClick={() => setComparisonTarget(run.id)}
                          type="button"
                        >
                          {comparisonTargetRunId === run.id ? "Comparison selected" : "Set as comparison"}
                        </button>
                        <button
                          className="analysis-inline-button"
                          disabled={runs.length < 2}
                          onClick={() => compareAgainstCurrentBaseline(run.id)}
                          type="button"
                        >
                          {comparisonBaseRunId === run.id
                            ? "Pick another run for this baseline"
                            : comparisonTargetRunId === run.id && comparisonBaseRunId
                              ? "Compared to current baseline"
                              : "Compare against current baseline"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-card__empty">No analysis runs yet.</p>
          )}
        </section>

        <section className="analysis-card">
          <div className="analysis-card__header-row">
            <h2 className="analysis-card__title">Answer history</h2>
            <span className="analysis-card__meta">{answers.length} stored</span>
          </div>
          <p className="analysis-card__copy">
            Final answers are generated only from stored analysis answer packages. Open a run to inspect
            assumptions, refutations, and the exact grounded answer text.
          </p>
          {answers.length ? (
            <ul className="analysis-study-list">
              {answers.map((answer) => (
                <li key={answer.id} className="analysis-study-list__item">
                  <div className="analysis-study-list__header">
                    <strong>
                      <Link className="analysis-study-list__link" href={`/analysis/studies/${study.id}/runs/${answer.runId}`}>
                        {answer.id}
                      </Link>
                    </strong>
                    <span className="analysis-study-list__status">{answer.modelName}</span>
                  </div>
                  <p className="analysis-study-list__meta">
                    Generated {formatTimestamp(answer.createdAt)} · prompt {answer.promptVersion}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-card__empty">No grounded answers yet. Open a completed run to generate one.</p>
          )}
        </section>
      </div>
    </section>
  );
}
