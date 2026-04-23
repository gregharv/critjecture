import {
  ANALYSIS_ASSUMPTION_STATUS_VALUES,
  ANALYSIS_ASSUMPTION_TYPE_VALUES,
  ANALYSIS_DATA_REQUIREMENT_STATUS_VALUES,
  ANALYSIS_DAG_NODE_OBSERVED_STATUS_VALUES,
  ANALYSIS_DAG_NODE_SOURCE_TYPE_VALUES,
  ANALYSIS_DAG_NODE_TYPE_VALUES,
} from "@/lib/analysis-dag-values";

export type GuardrailSeverity = "error" | "warning";

export type DraftDagGuardrailIssue = {
  message: string;
  severity: GuardrailSeverity;
};

export type DraftDagGuardrails = {
  edgeIssues: Record<string, DraftDagGuardrailIssue[]>;
  errors: string[];
  nodeIssues: Record<string, DraftDagGuardrailIssue[]>;
  outcomeNodeKeys: string[];
  treatmentNodeKeys: string[];
  warnings: string[];
};

export type DraftDagGuardrailNodeInput = {
  datasetColumnId?: string | null;
  label: string;
  nodeKey: string;
  nodeType: string;
  observedStatus: string;
  sourceType: string;
};

export type DraftDagGuardrailEdgeInput = {
  edgeKey?: string | null;
  relationshipLabel?: string | null;
  sourceNodeKey: string;
  targetNodeKey: string;
};

export type DraftDagGuardrailAssumptionInput = {
  assumptionType: string;
  description: string;
  relatedNodeKey?: string | null;
  status?: string | null;
};

export type DraftDagGuardrailDataRequirementInput = {
  relatedNodeKey?: string | null;
  status?: string | null;
  variableLabel: string;
};

export type DraftDagGuardrailInput = {
  assumptions: DraftDagGuardrailAssumptionInput[];
  dataRequirements: DraftDagGuardrailDataRequirementInput[];
  edges: DraftDagGuardrailEdgeInput[];
  nodes: DraftDagGuardrailNodeInput[];
  primaryDatasetVersionId?: string | null;
};

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function addIssue(
  record: Record<string, DraftDagGuardrailIssue[]>,
  key: string | null | undefined,
  issue: DraftDagGuardrailIssue,
) {
  if (!key) {
    return;
  }

  const current = record[key] ?? [];
  if (current.some((item) => item.message === issue.message && item.severity === issue.severity)) {
    return;
  }

  record[key] = [...current, issue];
}

function pushMessage(target: string[], message: string) {
  if (!target.includes(message)) {
    target.push(message);
  }
}

function addNodeError(
  nodeIssues: Record<string, DraftDagGuardrailIssue[]>,
  errors: string[],
  nodeKey: string | null | undefined,
  message: string,
) {
  addIssue(nodeIssues, nodeKey, { message, severity: "error" });
  pushMessage(errors, message);
}

function addNodeWarning(
  nodeIssues: Record<string, DraftDagGuardrailIssue[]>,
  warnings: string[],
  nodeKey: string | null | undefined,
  message: string,
) {
  addIssue(nodeIssues, nodeKey, { message, severity: "warning" });
  pushMessage(warnings, message);
}

function addEdgeError(
  edgeIssues: Record<string, DraftDagGuardrailIssue[]>,
  errors: string[],
  edgeKey: string | null | undefined,
  message: string,
) {
  addIssue(edgeIssues, edgeKey, { message, severity: "error" });
  pushMessage(errors, message);
}

function findDirectedPath(input: {
  edges: DraftDagGuardrailEdgeInput[];
  sourceNodeKey: string;
  targetNodeKey: string;
}) {
  const outgoing = new Map<string, string[]>();

  for (const edge of input.edges) {
    const next = outgoing.get(edge.sourceNodeKey) ?? [];
    next.push(edge.targetNodeKey);
    outgoing.set(edge.sourceNodeKey, next);
  }

  const queue = [input.sourceNodeKey];
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current === input.targetNodeKey) {
      return true;
    }

    for (const next of outgoing.get(current) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push(next);
    }
  }

  return false;
}

function detectCycle(input: {
  edgeIssues: Record<string, DraftDagGuardrailIssue[]>;
  edges: DraftDagGuardrailEdgeInput[];
  errors: string[];
  nodeIssues: Record<string, DraftDagGuardrailIssue[]>;
  nodeKeys: string[];
}) {
  const adjacency = new Map<string, Array<{ edgeKey: string; targetNodeKey: string }>>();
  const validNodeKeySet = new Set(input.nodeKeys);

  for (const edge of input.edges) {
    if (!validNodeKeySet.has(edge.sourceNodeKey) || !validNodeKeySet.has(edge.targetNodeKey)) {
      continue;
    }

    const edgeKey = normalizeText(edge.edgeKey) || `${edge.sourceNodeKey}->${edge.targetNodeKey}`;
    const next = adjacency.get(edge.sourceNodeKey) ?? [];
    next.push({ edgeKey, targetNodeKey: edge.targetNodeKey });
    adjacency.set(edge.sourceNodeKey, next);
  }

  const state = new Map<string, 0 | 1 | 2>();

  const visit = (nodeKey: string, pathNodes: string[], pathEdges: string[]) => {
    state.set(nodeKey, 1);
    pathNodes.push(nodeKey);

    for (const next of adjacency.get(nodeKey) ?? []) {
      const targetState = state.get(next.targetNodeKey) ?? 0;

      if (targetState === 0) {
        const detected = visit(next.targetNodeKey, [...pathNodes], [...pathEdges, next.edgeKey]);
        if (detected) {
          return true;
        }
        continue;
      }

      if (targetState === 1) {
        const cycleMessage = "The DAG must be acyclic before approval.";
        pushMessage(input.errors, cycleMessage);

        const cycleStartIndex = pathNodes.indexOf(next.targetNodeKey);
        const cycleNodes = cycleStartIndex >= 0 ? pathNodes.slice(cycleStartIndex) : [next.targetNodeKey];
        const cycleEdges = cycleStartIndex >= 0 ? pathEdges.slice(cycleStartIndex) : [];
        cycleEdges.push(next.edgeKey);

        for (const cycleNodeKey of cycleNodes) {
          addIssue(input.nodeIssues, cycleNodeKey, { message: cycleMessage, severity: "error" });
        }

        for (const cycleEdgeKey of cycleEdges) {
          addIssue(input.edgeIssues, cycleEdgeKey, { message: cycleMessage, severity: "error" });
        }

        return true;
      }
    }

    state.set(nodeKey, 2);
    return false;
  };

  for (const nodeKey of input.nodeKeys) {
    if ((state.get(nodeKey) ?? 0) === 0 && visit(nodeKey, [], [])) {
      return true;
    }
  }

  return false;
}

export function evaluateAnalysisDraftDagGuardrails(input: {
  datasetColumnIds?: Iterable<string>;
  draft: DraftDagGuardrailInput;
  requirePinnedPrimaryDataset: boolean;
}): DraftDagGuardrails {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIssues: Record<string, DraftDagGuardrailIssue[]> = {};
  const edgeIssues: Record<string, DraftDagGuardrailIssue[]> = {};
  const datasetColumnIdSet = new Set(input.datasetColumnIds ?? []);
  const nodeKeySet = new Set<string>();
  const edgeKeySet = new Set<string>();
  const treatmentNodeKeys: string[] = [];
  const outcomeNodeKeys: string[] = [];

  if (input.requirePinnedPrimaryDataset && !normalizeText(input.draft.primaryDatasetVersionId)) {
    pushMessage(errors, "An exact primary dataset version must be pinned on the DAG version.");
  }

  if (input.draft.nodes.length === 0) {
    pushMessage(errors, "A DAG version must contain at least one node.");
  }

  for (const node of input.draft.nodes) {
    const normalizedNodeKey = normalizeText(node.nodeKey);

    if (!normalizedNodeKey) {
      pushMessage(errors, "Every DAG node must include a non-empty nodeKey.");
      continue;
    }

    if (nodeKeySet.has(normalizedNodeKey)) {
      addNodeError(nodeIssues, errors, normalizedNodeKey, `Duplicate nodeKey detected: ${normalizedNodeKey}.`);
    }
    nodeKeySet.add(normalizedNodeKey);

    if (!normalizeText(node.label)) {
      addNodeError(nodeIssues, errors, normalizedNodeKey, `Node ${normalizedNodeKey} must include a non-empty label.`);
    }

    if (!(ANALYSIS_DAG_NODE_TYPE_VALUES as readonly string[]).includes(node.nodeType)) {
      addNodeError(nodeIssues, errors, normalizedNodeKey, `Node ${normalizedNodeKey} has an invalid nodeType.`);
    }

    if (!(ANALYSIS_DAG_NODE_SOURCE_TYPE_VALUES as readonly string[]).includes(node.sourceType)) {
      addNodeError(nodeIssues, errors, normalizedNodeKey, `Node ${normalizedNodeKey} has an invalid sourceType.`);
    }

    if (!(ANALYSIS_DAG_NODE_OBSERVED_STATUS_VALUES as readonly string[]).includes(node.observedStatus)) {
      addNodeError(nodeIssues, errors, normalizedNodeKey, `Node ${normalizedNodeKey} has an invalid observedStatus.`);
    }

    if (node.nodeType === "treatment") {
      treatmentNodeKeys.push(normalizedNodeKey);
    }

    if (node.nodeType === "outcome") {
      outcomeNodeKeys.push(normalizedNodeKey);
    }

    if (node.sourceType === "dataset") {
      const columnId = normalizeText(node.datasetColumnId);
      if (!columnId) {
        addNodeError(
          nodeIssues,
          errors,
          normalizedNodeKey,
          `Dataset-backed node ${normalizedNodeKey} must map to a real dataset column.`,
        );
      } else if (datasetColumnIdSet.size > 0 && !datasetColumnIdSet.has(columnId)) {
        addNodeError(
          nodeIssues,
          errors,
          normalizedNodeKey,
          `Dataset-backed node ${normalizedNodeKey} references an unknown dataset column.`,
        );
      }
    }

    if (node.nodeType === "latent" && node.observedStatus !== "unobserved") {
      addNodeError(
        nodeIssues,
        errors,
        normalizedNodeKey,
        `Latent node ${normalizedNodeKey} must remain explicitly unobserved.`,
      );
    }

    if (node.nodeType === "external_data_needed" && node.observedStatus !== "missing_external") {
      addNodeError(
        nodeIssues,
        errors,
        normalizedNodeKey,
        `External-data-needed node ${normalizedNodeKey} must remain explicitly missing_external.`,
      );
    }
  }

  for (const edge of input.draft.edges) {
    const edgeKey = normalizeText(edge.edgeKey) || `${edge.sourceNodeKey}->${edge.targetNodeKey}`;

    if (edgeKeySet.has(edgeKey)) {
      addEdgeError(edgeIssues, errors, edgeKey, `Duplicate edgeKey detected: ${edgeKey}.`);
    }
    edgeKeySet.add(edgeKey);

    if (!nodeKeySet.has(edge.sourceNodeKey)) {
      addEdgeError(
        edgeIssues,
        errors,
        edgeKey,
        `Edge ${edgeKey} references unknown source node ${edge.sourceNodeKey}.`,
      );
    }

    if (!nodeKeySet.has(edge.targetNodeKey)) {
      addEdgeError(
        edgeIssues,
        errors,
        edgeKey,
        `Edge ${edgeKey} references unknown target node ${edge.targetNodeKey}.`,
      );
    }

    if (edge.sourceNodeKey === edge.targetNodeKey) {
      addEdgeError(edgeIssues, errors, edgeKey, `Edge ${edgeKey} cannot be a self-loop.`);
    }

    if (!normalizeText(edge.relationshipLabel)) {
      addEdgeWarning(edgeIssues, warnings, edgeKey, `Edge ${edgeKey} should include a readable relationship label.`);
    }
  }

  detectCycle({
    edgeIssues,
    edges: input.draft.edges,
    errors,
    nodeIssues,
    nodeKeys: [...nodeKeySet],
  });

  if (treatmentNodeKeys.length !== 1) {
    pushMessage(errors, "Exactly one treatment node is required in V2.0.");
    for (const nodeKey of treatmentNodeKeys) {
      addNodeError(nodeIssues, errors, nodeKey, "Only one treatment node can be active at a time.");
    }
  }

  if (outcomeNodeKeys.length !== 1) {
    pushMessage(errors, "Exactly one outcome node is required in V2.0.");
    for (const nodeKey of outcomeNodeKeys) {
      addNodeError(nodeIssues, errors, nodeKey, "Only one outcome node can be active at a time.");
    }
  }

  if (treatmentNodeKeys.length === 1 && outcomeNodeKeys.length === 1) {
    const hasPath = findDirectedPath({
      edges: input.draft.edges,
      sourceNodeKey: treatmentNodeKeys[0],
      targetNodeKey: outcomeNodeKeys[0],
    });

    if (!hasPath) {
      const message = "No directed path from the treatment node to the outcome node is drawn yet.";
      pushMessage(warnings, message);
      addNodeWarning(nodeIssues, warnings, treatmentNodeKeys[0], message);
      addNodeWarning(nodeIssues, warnings, outcomeNodeKeys[0], message);
    }
  }

  for (const assumption of input.draft.assumptions) {
    if (!(ANALYSIS_ASSUMPTION_TYPE_VALUES as readonly string[]).includes(assumption.assumptionType)) {
      pushMessage(errors, `Assumption "${assumption.description}" has an invalid assumptionType.`);
    }

    if (
      assumption.status &&
      !(ANALYSIS_ASSUMPTION_STATUS_VALUES as readonly string[]).includes(assumption.status)
    ) {
      pushMessage(errors, `Assumption "${assumption.description}" has an invalid status.`);
    }

    if (assumption.relatedNodeKey && !nodeKeySet.has(assumption.relatedNodeKey)) {
      pushMessage(errors, `Assumption "${assumption.description}" references an unknown node.`);
    }
  }

  for (const requirement of input.draft.dataRequirements) {
    if (
      !(ANALYSIS_DATA_REQUIREMENT_STATUS_VALUES as readonly string[]).includes(requirement.status ?? "missing")
    ) {
      pushMessage(errors, `Data requirement "${requirement.variableLabel}" has an invalid status.`);
    }

    if (requirement.relatedNodeKey && !nodeKeySet.has(requirement.relatedNodeKey)) {
      pushMessage(errors, `Data requirement "${requirement.variableLabel}" references an unknown node.`);
    }
  }

  return {
    edgeIssues,
    errors,
    nodeIssues,
    outcomeNodeKeys,
    treatmentNodeKeys,
    warnings,
  };
}

function addEdgeWarning(
  edgeIssues: Record<string, DraftDagGuardrailIssue[]>,
  warnings: string[],
  edgeKey: string | null | undefined,
  message: string,
) {
  addIssue(edgeIssues, edgeKey, { message, severity: "warning" });
  pushMessage(warnings, message);
}
