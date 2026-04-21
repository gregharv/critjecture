import "server-only";

import {
  CAUSAL_APPROVAL_KIND_VALUES,
  CAUSAL_ASSUMPTION_STATUS_VALUES,
  CAUSAL_ASSUMPTION_TYPE_VALUES,
  CAUSAL_DATA_REQUIREMENT_STATUS_VALUES,
  CAUSAL_DAG_NODE_OBSERVED_STATUS_VALUES,
  CAUSAL_DAG_NODE_SOURCE_TYPE_VALUES,
  CAUSAL_DAG_NODE_TYPE_VALUES,
} from "@/lib/causal-dag-values";

export type DraftCausalDagNodeInput = {
  assumptionNote?: string | null;
  datasetColumnId?: string | null;
  description?: string | null;
  label: string;
  metadataJson?: string | null;
  nodeKey: string;
  nodeType: string;
  observedStatus: string;
  positionX?: number | null;
  positionY?: number | null;
  sourceType: string;
};

export type DraftCausalDagEdgeInput = {
  edgeKey?: string | null;
  note?: string | null;
  relationshipLabel?: string | null;
  sourceNodeKey: string;
  targetNodeKey: string;
};

export type DraftCausalAssumptionInput = {
  assumptionType: string;
  description: string;
  relatedEdgeKey?: string | null;
  relatedNodeKey?: string | null;
  status?: string | null;
};

export type DraftCausalDataRequirementInput = {
  importanceRank?: number | null;
  reasonNeeded: string;
  relatedNodeKey?: string | null;
  status?: string | null;
  suggestedSource?: string | null;
  variableLabel: string;
};

export type DraftCausalDagInput = {
  assumptions: DraftCausalAssumptionInput[];
  dataRequirements: DraftCausalDataRequirementInput[];
  description?: string | null;
  edges: DraftCausalDagEdgeInput[];
  layoutJson?: string | null;
  nodes: DraftCausalDagNodeInput[];
  primaryDatasetVersionId?: string | null;
  title?: string | null;
};

export type DagDatasetColumnReference = {
  columnName: string;
  datasetVersionId: string;
  displayName: string;
  id: string;
};

export type DagValidationResult = {
  errors: string[];
  outcomeNodeKeys: string[];
  treatmentNodeKeys: string[];
  warnings: string[];
};

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function parseMetadataJson(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function detectCycle(nodeKeys: string[], edges: DraftCausalDagEdgeInput[]) {
  const incomingCount = new Map(nodeKeys.map((key) => [key, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    incomingCount.set(edge.targetNodeKey, (incomingCount.get(edge.targetNodeKey) ?? 0) + 1);
    const next = outgoing.get(edge.sourceNodeKey) ?? [];
    next.push(edge.targetNodeKey);
    outgoing.set(edge.sourceNodeKey, next);
  }

  const queue = nodeKeys.filter((key) => (incomingCount.get(key) ?? 0) === 0);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    visited += 1;

    for (const target of outgoing.get(current) ?? []) {
      const nextIncoming = (incomingCount.get(target) ?? 0) - 1;
      incomingCount.set(target, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(target);
      }
    }
  }

  return visited !== nodeKeys.length;
}

export function validateDraftCausalDag(input: {
  datasetColumnMap: Map<string, DagDatasetColumnReference>;
  draft: DraftCausalDagInput;
  requirePinnedPrimaryDataset: boolean;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeKeySet = new Set<string>();
  const edgeKeySet = new Set<string>();
  const treatmentNodeKeys: string[] = [];
  const outcomeNodeKeys: string[] = [];

  if (input.requirePinnedPrimaryDataset && !normalizeText(input.draft.primaryDatasetVersionId)) {
    errors.push("An exact primary dataset version must be pinned on the DAG version.");
  }

  if (input.draft.nodes.length === 0) {
    errors.push("A DAG version must contain at least one node.");
  }

  for (const node of input.draft.nodes) {
    if (!normalizeText(node.nodeKey)) {
      errors.push("Every DAG node must include a non-empty nodeKey.");
      continue;
    }

    if (nodeKeySet.has(node.nodeKey)) {
      errors.push(`Duplicate nodeKey detected: ${node.nodeKey}.`);
    }
    nodeKeySet.add(node.nodeKey);

    if (!normalizeText(node.label)) {
      errors.push(`Node ${node.nodeKey} must include a non-empty label.`);
    }

    if (!(CAUSAL_DAG_NODE_TYPE_VALUES as readonly string[]).includes(node.nodeType)) {
      errors.push(`Node ${node.nodeKey} has an invalid nodeType.`);
    }

    if (!(CAUSAL_DAG_NODE_SOURCE_TYPE_VALUES as readonly string[]).includes(node.sourceType)) {
      errors.push(`Node ${node.nodeKey} has an invalid sourceType.`);
    }

    if (!(CAUSAL_DAG_NODE_OBSERVED_STATUS_VALUES as readonly string[]).includes(node.observedStatus)) {
      errors.push(`Node ${node.nodeKey} has an invalid observedStatus.`);
    }

    if (node.nodeType === "treatment") {
      treatmentNodeKeys.push(node.nodeKey);
    }

    if (node.nodeType === "outcome") {
      outcomeNodeKeys.push(node.nodeKey);
    }

    if (node.sourceType === "dataset") {
      const columnId = normalizeText(node.datasetColumnId);
      if (!columnId) {
        errors.push(`Dataset-backed node ${node.nodeKey} must map to a real dataset column.`);
      } else if (!input.datasetColumnMap.has(columnId)) {
        errors.push(`Dataset-backed node ${node.nodeKey} references an unknown dataset column.`);
      }
    }

    if (node.nodeType === "latent" && node.observedStatus !== "unobserved") {
      errors.push(`Latent node ${node.nodeKey} must remain explicitly unobserved.`);
    }

    if (node.nodeType === "external_data_needed" && node.observedStatus !== "missing_external") {
      errors.push(`External-data-needed node ${node.nodeKey} must remain explicitly missing_external.`);
    }
  }

  for (const edge of input.draft.edges) {
    const edgeKey = normalizeText(edge.edgeKey) || `${edge.sourceNodeKey}->${edge.targetNodeKey}`;

    if (edgeKeySet.has(edgeKey)) {
      errors.push(`Duplicate edgeKey detected: ${edgeKey}.`);
    }
    edgeKeySet.add(edgeKey);

    if (!nodeKeySet.has(edge.sourceNodeKey)) {
      errors.push(`Edge ${edgeKey} references unknown source node ${edge.sourceNodeKey}.`);
    }

    if (!nodeKeySet.has(edge.targetNodeKey)) {
      errors.push(`Edge ${edgeKey} references unknown target node ${edge.targetNodeKey}.`);
    }

    if (edge.sourceNodeKey === edge.targetNodeKey) {
      errors.push(`Edge ${edgeKey} cannot be a self-loop.`);
    }
  }

  if (detectCycle([...nodeKeySet], input.draft.edges)) {
    errors.push("The DAG must be acyclic before approval.");
  }

  if (treatmentNodeKeys.length !== 1) {
    errors.push("Exactly one treatment node is required in V2.0.");
  }

  if (outcomeNodeKeys.length !== 1) {
    errors.push("Exactly one outcome node is required in V2.0.");
  }

  for (const assumption of input.draft.assumptions) {
    if (!(CAUSAL_ASSUMPTION_TYPE_VALUES as readonly string[]).includes(assumption.assumptionType)) {
      errors.push(`Assumption \"${assumption.description}\" has an invalid assumptionType.`);
    }

    if (assumption.status && !(CAUSAL_ASSUMPTION_STATUS_VALUES as readonly string[]).includes(assumption.status)) {
      errors.push(`Assumption \"${assumption.description}\" has an invalid status.`);
    }

    if (assumption.relatedNodeKey && !nodeKeySet.has(assumption.relatedNodeKey)) {
      errors.push(`Assumption \"${assumption.description}\" references an unknown node.`);
    }
  }

  for (const requirement of input.draft.dataRequirements) {
    if (!(CAUSAL_DATA_REQUIREMENT_STATUS_VALUES as readonly string[]).includes(requirement.status ?? "missing")) {
      errors.push(`Data requirement \"${requirement.variableLabel}\" has an invalid status.`);
    }

    if (requirement.relatedNodeKey && !nodeKeySet.has(requirement.relatedNodeKey)) {
      errors.push(`Data requirement \"${requirement.variableLabel}\" references an unknown node.`);
    }
  }

  const graphJson = JSON.stringify({
    assumptions: input.draft.assumptions.map((assumption) => ({
      ...assumption,
      description: normalizeText(assumption.description),
      status: assumption.status ?? "asserted",
    })),
    dataRequirements: input.draft.dataRequirements.map((requirement) => ({
      ...requirement,
      reasonNeeded: normalizeText(requirement.reasonNeeded),
      status: requirement.status ?? "missing",
      variableLabel: normalizeText(requirement.variableLabel),
    })),
    edges: input.draft.edges.map((edge) => ({
      edgeKey: normalizeText(edge.edgeKey) || `${edge.sourceNodeKey}->${edge.targetNodeKey}`,
      note: normalizeText(edge.note) || null,
      relationshipLabel: normalizeText(edge.relationshipLabel) || "causes",
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
    })),
    layout: parseMetadataJson(input.draft.layoutJson),
    nodes: input.draft.nodes.map((node) => ({
      assumptionNote: normalizeText(node.assumptionNote) || null,
      datasetColumnId: normalizeText(node.datasetColumnId) || null,
      description: normalizeText(node.description) || null,
      label: normalizeText(node.label),
      metadata: parseMetadataJson(node.metadataJson),
      nodeKey: normalizeText(node.nodeKey),
      nodeType: node.nodeType,
      observedStatus: node.observedStatus,
      position: {
        x: typeof node.positionX === "number" ? node.positionX : 0,
        y: typeof node.positionY === "number" ? node.positionY : 0,
      },
      sourceType: node.sourceType,
    })),
    outcomeNodeKey: outcomeNodeKeys[0] ?? null,
    primaryDatasetVersionId: normalizeText(input.draft.primaryDatasetVersionId) || null,
    treatmentNodeKey: treatmentNodeKeys[0] ?? null,
  });

  const validationJson = JSON.stringify({
    errors,
    outcomeNodeKeys,
    treatmentNodeKeys,
    validatedAt: Date.now(),
    warnings,
  });

  return {
    graphJson,
    outcomeNodeKey: outcomeNodeKeys[0] ?? null,
    treatmentNodeKey: treatmentNodeKeys[0] ?? null,
    validation: {
      errors,
      outcomeNodeKeys,
      treatmentNodeKeys,
      warnings,
    } satisfies DagValidationResult,
    validationJson,
  };
}

export function buildDefaultApprovalText() {
  return "I confirm that this DAG reflects my current causal assumptions, including observed variables, unobserved variables, and any external data still needed.";
}
