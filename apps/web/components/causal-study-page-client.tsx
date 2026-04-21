"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  CAUSAL_ASSUMPTION_STATUS_VALUES,
  CAUSAL_ASSUMPTION_TYPE_VALUES,
  CAUSAL_DATA_REQUIREMENT_STATUS_VALUES,
  CAUSAL_DAG_NODE_OBSERVED_STATUS_VALUES,
  CAUSAL_DAG_NODE_TYPE_VALUES,
} from "@/lib/causal-dag-values";

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

type CausalDagWorkspaceDetail = {
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

type CausalRunSummary = {
  completedAt: number | null;
  createdAt: number;
  id: string;
  status: string;
};

type CausalAnswerSummary = {
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

type CausalStudyPageClientProps = {
  initialAnswers: CausalAnswerSummary[];
  initialCurrentQuestion: CurrentQuestionSummary;
  initialDagWorkspace: CausalDagWorkspaceDetail;
  initialDatasetBinding: StudyDatasetBindingDetail;
  initialRuns: CausalRunSummary[];
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

const DEFAULT_APPROVAL_TEXT =
  "I confirm that this DAG reflects my current causal assumptions, including observed variables, unobserved variables, and any external data still needed.";

function formatTimestamp(timestamp: number) {
  return DATE_TIME_FORMATTER.format(timestamp);
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

function getDraftAutosaveKey(studyId: string) {
  return `critjecture:causal-draft:${studyId}`;
}

function buildSeededDraft(
  datasetBinding: StudyDatasetBindingDetail,
  dagWorkspace: CausalDagWorkspaceDetail,
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
  dagWorkspace: CausalDagWorkspaceDetail,
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
      title: dagWorkspace.dag?.title ?? "Causal DAG",
    };
  } catch {
    return fallbackSeedDraft;
  }
}

export function CausalStudyPageClient({
  initialAnswers,
  initialCurrentQuestion,
  initialDagWorkspace,
  initialDatasetBinding,
  initialRuns,
  study,
}: CausalStudyPageClientProps) {
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
      const autosaved = window.localStorage.getItem(getDraftAutosaveKey(study.id));

      if (autosaved) {
        try {
          return JSON.parse(autosaved) as DagDraft;
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

  useEffect(() => {
    if (!dagDraft || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(getDraftAutosaveKey(study.id), JSON.stringify(dagDraft));
  }, [dagDraft, study.id]);

  async function refreshStudy(syncDraft = false) {
    const response = await fetch(`/api/causal/studies/${study.id}`, {
      cache: "no-store",
    });
    const json = (await response.json()) as unknown;

    if (!response.ok) {
      throw new Error(getErrorMessage(json, "Failed to refresh causal study."));
    }

    const next = json as {
      answers: CausalAnswerSummary[];
      currentQuestion: CurrentQuestionSummary;
      dagWorkspace: CausalDagWorkspaceDetail;
      datasetBinding: StudyDatasetBindingDetail;
      runs: CausalRunSummary[];
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

  async function handleSaveStudyMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/causal/studies/${study.id}`, {
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
        throw new Error(getErrorMessage(json, "Failed to update the causal study."));
      }

      await refreshStudy(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update the causal study.");
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
      const response = await fetch(`/api/causal/studies/${study.id}/dataset-bindings`, {
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
      nodes: dagDraft.nodes.filter((node) => node.nodeKey !== nodeKey),
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
  }

  function addEdge() {
    if (!dagDraft) {
      return;
    }

    if (!newEdge.sourceNodeKey || !newEdge.targetNodeKey) {
      setError("Choose both a source and target node for each edge.");
      return;
    }

    setError(null);
    const edgeKey = `${newEdge.sourceNodeKey}->${newEdge.targetNodeKey}`;
    setDagDraft({
      ...dagDraft,
      edges: [
        ...dagDraft.edges,
        {
          edgeKey,
          note: "",
          relationshipLabel: newEdge.relationshipLabel.trim() || "causes",
          sourceNodeKey: newEdge.sourceNodeKey,
          targetNodeKey: newEdge.targetNodeKey,
        },
      ],
    });
    setNewEdge({ relationshipLabel: "causes", sourceNodeKey: "", targetNodeKey: "" });
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

  async function handleSaveDagVersion() {
    if (!dagDraft) {
      setError("Seed or build a draft DAG before saving a version.");
      return;
    }

    setPending(true);
    setError(null);

    try {
      let dagId = dagWorkspace.dag?.id ?? null;

      if (!dagId) {
        const dagResponse = await fetch(`/api/causal/studies/${study.id}/dags`, {
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

      const versionResponse = await fetch(`/api/causal/dags/${dagId}/versions`, {
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

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/causal/dags/${dagWorkspace.dag.id}/approve`, {
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
      const response = await fetch("/api/causal/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ studyId: study.id }),
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to create the causal run."));
      }

      await refreshStudy(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create the causal run.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="causal-page">
      <div className="causal-hero">
        <p className="causal-hero__eyebrow">Study detail</p>
        <h1 className="causal-hero__title">{studyTitle}</h1>
        <p className="causal-hero__copy">
          Status: {studyStatus}. Updated {formatTimestamp(studyUpdatedAt)}.
        </p>
        {currentQuestion ? (
          <p className="causal-card__meta">
            Active question: {currentQuestion.questionText}
            {currentQuestion.proposedTreatmentLabel ? ` · suggested treatment ${currentQuestion.proposedTreatmentLabel}` : ""}
            {currentQuestion.proposedOutcomeLabel ? ` · suggested outcome ${currentQuestion.proposedOutcomeLabel}` : ""}
          </p>
        ) : null}
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">Study summary</h2>
            <span className="causal-card__meta">Autosave is local to this browser for DAG drafts.</span>
          </div>
          <form className="causal-intake-form" onSubmit={handleSaveStudyMetadata}>
            <label className="causal-intake-form__label" htmlFor="causal-study-title">
              Study title
            </label>
            <input
              id="causal-study-title"
              className="causal-text-input"
              disabled={pending}
              onChange={(event) => setStudyTitle(event.target.value)}
              value={studyTitle}
            />
            <label className="causal-intake-form__label" htmlFor="causal-study-description">
              Study description
            </label>
            <textarea
              id="causal-study-description"
              className="causal-intake-form__textarea"
              disabled={pending}
              onChange={(event) => setStudyDescription(event.target.value)}
              rows={3}
              value={studyDescription}
            />
            <div className="causal-intake-form__actions">
              <button className="causal-intake-form__submit" disabled={pending} type="submit">
                {pending ? "Saving…" : "Save study summary"}
              </button>
            </div>
          </form>
          {currentQuestion ? (
            <ul className="causal-list">
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
            <p className="causal-card__empty">No active question is attached to this study yet.</p>
          )}
        </section>

        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">Primary dataset binding</h2>
            <button className="causal-inline-button" onClick={() => void refreshStudy(true)} type="button">
              Refresh
            </button>
          </div>
          <p className="causal-card__copy">
            Pin exactly one active primary dataset version before DAG approval or run creation.
          </p>
          <form className="causal-intake-form" onSubmit={handleBindPrimaryDataset}>
            <label className="causal-intake-form__label" htmlFor="causal-study-dataset">
              Dataset
            </label>
            <select
              id="causal-study-dataset"
              className="causal-select"
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

            <label className="causal-intake-form__label" htmlFor="causal-study-dataset-version">
              Exact dataset version
            </label>
            <select
              id="causal-study-dataset-version"
              className="causal-select"
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

            <div className="causal-intake-form__actions">
              <button className="causal-intake-form__submit" disabled={pending} type="submit">
                {pending ? "Pinning…" : "Pin primary dataset"}
              </button>
              {error ? <p className="causal-intake-form__error">{error}</p> : null}
            </div>
          </form>
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Readiness gate</h2>
          <div className="causal-readiness">
            <p className="causal-card__meta">
              DAG approval: {datasetBinding.readiness.canApproveDag ? "ready" : "blocked"}
            </p>
            <p className="causal-card__meta">
              Run creation: {datasetBinding.readiness.canCreateRun ? "ready" : "blocked"}
            </p>
            {datasetBinding.readiness.reasons.length ? (
              <ul className="causal-list">
                {datasetBinding.readiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="causal-card__meta">Primary dataset pinning requirements are satisfied.</p>
            )}
          </div>
        </section>
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">DAG workspace</h2>
            <div className="causal-inline-actions">
              <button className="causal-inline-button" onClick={handleSeedDraftFromDataset} type="button">
                Seed from dataset
              </button>
              <button className="causal-inline-button" disabled={pending || !dagDraft} onClick={() => void handleSaveDagVersion()} type="button">
                Save version
              </button>
            </div>
          </div>
          <p className="causal-card__copy">
            Drafts are stored as graph JSON and normalized rows. Missing and unobserved variables
            must remain explicit.
          </p>
          {dagDraft ? (
            <div className="causal-editor-stack">
              <label className="causal-intake-form__label" htmlFor="causal-dag-title">
                DAG title
              </label>
              <input
                id="causal-dag-title"
                className="causal-text-input"
                onChange={(event) => setDagDraft({ ...dagDraft, title: event.target.value })}
                value={dagDraft.title}
              />

              <label className="causal-intake-form__label" htmlFor="causal-dag-description">
                DAG description
              </label>
              <textarea
                id="causal-dag-description"
                className="causal-intake-form__textarea"
                onChange={(event) => setDagDraft({ ...dagDraft, description: event.target.value })}
                rows={3}
                value={dagDraft.description}
              />

              <div className="causal-editor-section">
                <h3 className="causal-card__title">Nodes</h3>
                <div className="causal-table">
                  {dagDraft.nodes.map((node) => (
                    <div key={node.nodeKey} className="causal-table__row">
                      <input
                        className="causal-text-input"
                        onChange={(event) => updateDraftNode(node.nodeKey, { label: event.target.value })}
                        value={node.label}
                      />
                      <select
                        className="causal-select"
                        onChange={(event) => updateDraftNode(node.nodeKey, { nodeType: event.target.value })}
                        value={node.nodeType}
                      >
                        {CAUSAL_DAG_NODE_TYPE_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <select
                        className="causal-select"
                        onChange={(event) => updateDraftNode(node.nodeKey, { observedStatus: event.target.value })}
                        value={node.observedStatus}
                      >
                        {CAUSAL_DAG_NODE_OBSERVED_STATUS_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <button className="causal-inline-button" onClick={() => removeDraftNode(node.nodeKey)} type="button">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="causal-inline-form">
                  <input
                    className="causal-text-input"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, nodeKey: event.target.value })}
                    placeholder="missing_confounder"
                    value={newCustomNode.nodeKey}
                  />
                  <input
                    className="causal-text-input"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, label: event.target.value })}
                    placeholder="Missing confounder"
                    value={newCustomNode.label}
                  />
                  <select
                    className="causal-select"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, nodeType: event.target.value })}
                    value={newCustomNode.nodeType}
                  >
                    {CAUSAL_DAG_NODE_TYPE_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="causal-select"
                    onChange={(event) => setNewCustomNode({ ...newCustomNode, observedStatus: event.target.value })}
                    value={newCustomNode.observedStatus}
                  >
                    {CAUSAL_DAG_NODE_OBSERVED_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <button className="causal-inline-button" onClick={addCustomNode} type="button">
                    Add node
                  </button>
                </div>
              </div>

              <div className="causal-editor-section">
                <h3 className="causal-card__title">Edges</h3>
                <div className="causal-table">
                  {dagDraft.edges.map((edge) => (
                    <div key={edge.edgeKey} className="causal-table__row">
                      <span className="causal-table__label">
                        {edge.sourceNodeKey} → {edge.targetNodeKey}
                      </span>
                      <input
                        className="causal-text-input"
                        onChange={(event) =>
                          setDagDraft({
                            ...dagDraft,
                            edges: dagDraft.edges.map((item) =>
                              item.edgeKey === edge.edgeKey
                                ? { ...item, relationshipLabel: event.target.value }
                                : item,
                            ),
                          })
                        }
                        value={edge.relationshipLabel}
                      />
                      <button
                        className="causal-inline-button"
                        onClick={() =>
                          setDagDraft({
                            ...dagDraft,
                            edges: dagDraft.edges.filter((item) => item.edgeKey !== edge.edgeKey),
                          })
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="causal-inline-form">
                  <select
                    className="causal-select"
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
                    className="causal-select"
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
                    className="causal-text-input"
                    onChange={(event) => setNewEdge({ ...newEdge, relationshipLabel: event.target.value })}
                    placeholder="causes"
                    value={newEdge.relationshipLabel}
                  />
                  <button className="causal-inline-button" onClick={addEdge} type="button">
                    Add edge
                  </button>
                </div>
              </div>

              <div className="causal-editor-section">
                <h3 className="causal-card__title">Assumptions</h3>
                <ul className="causal-list">
                  {dagDraft.assumptions.map((assumption, index) => (
                    <li key={`${assumption.description}-${index}`}>
                      {assumption.assumptionType}: {assumption.description}
                    </li>
                  ))}
                </ul>
                <div className="causal-inline-form">
                  <select
                    className="causal-select"
                    onChange={(event) => setNewAssumption({ ...newAssumption, assumptionType: event.target.value })}
                    value={newAssumption.assumptionType}
                  >
                    {CAUSAL_ASSUMPTION_TYPE_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="causal-select"
                    onChange={(event) => setNewAssumption({ ...newAssumption, status: event.target.value })}
                    value={newAssumption.status}
                  >
                    {CAUSAL_ASSUMPTION_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="causal-select"
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
                    className="causal-text-input"
                    onChange={(event) => setNewAssumption({ ...newAssumption, description: event.target.value })}
                    placeholder="Describe the assumption"
                    value={newAssumption.description}
                  />
                  <button className="causal-inline-button" onClick={addAssumption} type="button">
                    Add assumption
                  </button>
                </div>
              </div>

              <div className="causal-editor-section">
                <h3 className="causal-card__title">Missing data requirements</h3>
                <ul className="causal-list">
                  {dagDraft.dataRequirements.map((requirement, index) => (
                    <li key={`${requirement.variableLabel}-${index}`}>
                      {requirement.variableLabel}: {requirement.reasonNeeded}
                    </li>
                  ))}
                </ul>
                <div className="causal-inline-form">
                  <input
                    className="causal-text-input"
                    onChange={(event) =>
                      setNewDataRequirement({ ...newDataRequirement, variableLabel: event.target.value })
                    }
                    placeholder="Variable label"
                    value={newDataRequirement.variableLabel}
                  />
                  <input
                    className="causal-text-input"
                    onChange={(event) =>
                      setNewDataRequirement({ ...newDataRequirement, reasonNeeded: event.target.value })
                    }
                    placeholder="Why is it needed?"
                    value={newDataRequirement.reasonNeeded}
                  />
                  <select
                    className="causal-select"
                    onChange={(event) => setNewDataRequirement({ ...newDataRequirement, status: event.target.value })}
                    value={newDataRequirement.status}
                  >
                    {CAUSAL_DATA_REQUIREMENT_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <select
                    className="causal-select"
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
                  <button className="causal-inline-button" onClick={addDataRequirement} type="button">
                    Add requirement
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="causal-card__empty">
              Pin a primary dataset version, then seed or build a DAG draft.
            </p>
          )}
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Approval and version history</h2>
          {dagWorkspace.currentVersion ? (
            <>
              <p className="causal-card__copy">
                Current version v{dagWorkspace.currentVersion.versionNumber}
                {dagWorkspace.currentVersion.treatmentNodeKey
                  ? ` · treatment ${dagWorkspace.currentVersion.treatmentNodeKey}`
                  : ""}
                {dagWorkspace.currentVersion.outcomeNodeKey
                  ? ` · outcome ${dagWorkspace.currentVersion.outcomeNodeKey}`
                  : ""}
              </p>
              <div className="causal-readiness">
                {dagWorkspace.currentVersion.validation.errors.length ? (
                  <ul className="causal-list">
                    {dagWorkspace.currentVersion.validation.errors.map((errorMessage) => (
                      <li key={errorMessage}>{errorMessage}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="causal-card__meta">Current version passes stored validation checks.</p>
                )}
              </div>
              <label className="causal-intake-form__label" htmlFor="causal-approval-text">
                Approval statement
              </label>
              <textarea
                id="causal-approval-text"
                className="causal-intake-form__textarea"
                onChange={(event) => setApprovalText(event.target.value)}
                rows={4}
                value={approvalText}
              />
              <button className="causal-intake-form__submit" disabled={pending} onClick={() => void handleApproveDagVersion()} type="button">
                {pending ? "Approving…" : "Approve current DAG version"}
              </button>
            </>
          ) : (
            <p className="causal-card__empty">No DAG version saved yet.</p>
          )}

          {dagWorkspace.dag?.versions.length ? (
            <ul className="causal-study-list">
              {dagWorkspace.dag.versions.map((version) => (
                <li key={version.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>Version {version.versionNumber}</strong>
                    <span className="causal-study-list__status">
                      {version.validation.errors.length ? "draft" : "valid"}
                    </span>
                  </div>
                  <p className="causal-study-list__meta">Saved {formatTimestamp(version.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {dagWorkspace.approvals.length ? (
            <div className="causal-approval-list">
              <h3 className="causal-card__title">Approvals</h3>
              <ul className="causal-list">
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

      <div className="causal-grid">
        <section className="causal-card">
          <h2 className="causal-card__title">Current bindings</h2>
          {datasetBinding.bindings.length ? (
            <ul className="causal-study-list">
              {datasetBinding.bindings.map((binding) => (
                <li key={binding.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{binding.dataset.displayName}</strong>
                    <span className="causal-study-list__status">
                      {binding.bindingRole} · {binding.isActive ? "active" : "inactive"}
                    </span>
                  </div>
                  <p className="causal-study-list__question">
                    {binding.datasetVersion
                      ? `Pinned to version ${binding.datasetVersion.versionNumber}`
                      : "No exact version pinned yet."}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No dataset bindings yet.</p>
          )}
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">DAG seeding contract</h2>
          {datasetBinding.seedContract ? (
            <>
              <p className="causal-card__copy">
                Seed from {datasetBinding.seedContract.dataset.displayName} v
                {datasetBinding.seedContract.datasetVersion.versionNumber}.
              </p>
              <ul className="causal-column-list">
                {datasetBinding.seedContract.columns.map((column) => (
                  <li key={column.id} className="causal-column-list__item">
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
            <p className="causal-card__empty">
              Pin a primary dataset version to expose dataset-backed columns for DAG seeding.
            </p>
          )}
        </section>

        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">Causal runs</h2>
            <button
              className="causal-intake-form__submit"
              disabled={pending || !datasetBinding.readiness.canCreateRun || !dagWorkspace.approvals.length}
              onClick={() => void handleCreateRun()}
              type="button"
            >
              {pending ? "Running…" : "Create causal run"}
            </button>
          </div>
          <p className="causal-card__copy">
            Runs are pinned to the approved DAG version and primary dataset version. If identification
            fails, the result remains honestly not identifiable.
          </p>
          {runs.length ? (
            <ul className="causal-study-list">
              {runs.map((run) => (
                <li key={run.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>
                      <Link className="causal-study-list__link" href={`/causal/studies/${study.id}/runs/${run.id}`}>
                        {run.id}
                      </Link>
                    </strong>
                    <span className="causal-study-list__status">{run.status}</span>
                  </div>
                  <p className="causal-study-list__meta">
                    Started {formatTimestamp(run.createdAt)}
                    {run.completedAt ? ` · completed ${formatTimestamp(run.completedAt)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No causal runs yet.</p>
          )}
        </section>

        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">Answer history</h2>
            <span className="causal-card__meta">{answers.length} stored</span>
          </div>
          <p className="causal-card__copy">
            Final answers are generated only from stored causal answer packages. Open a run to inspect
            assumptions, refutations, and the exact grounded answer text.
          </p>
          {answers.length ? (
            <ul className="causal-study-list">
              {answers.map((answer) => (
                <li key={answer.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>
                      <Link className="causal-study-list__link" href={`/causal/studies/${study.id}/runs/${answer.runId}`}>
                        {answer.id}
                      </Link>
                    </strong>
                    <span className="causal-study-list__status">{answer.modelName}</span>
                  </div>
                  <p className="causal-study-list__meta">
                    Generated {formatTimestamp(answer.createdAt)} · prompt {answer.promptVersion}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No grounded answers yet. Open a completed run to generate one.</p>
          )}
        </section>
      </div>
    </section>
  );
}
