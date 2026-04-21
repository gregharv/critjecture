export type DraftDagPathNodeInput = {
  nodeKey: string;
  nodeType: string;
};

export type DraftDagPathEdgeInput = {
  edgeKey?: string | null;
  sourceNodeKey: string;
  targetNodeKey: string;
};

export type DraftDagPathAssistanceInput = {
  edges: DraftDagPathEdgeInput[];
  nodes: DraftDagPathNodeInput[];
};

export type DraftDagPathSuggestion = {
  message: string;
  sourceNodeKey?: string;
  targetNodeKey?: string;
};

export type DraftDagPathAssistance = {
  canReachOutcomeNodeKeys: string[];
  disconnectedNodeKeys: string[];
  pathEdgeKeys: string[];
  pathExists: boolean;
  pathNodeKeys: string[];
  reachableFromTreatmentNodeKeys: string[];
  suggestions: DraftDagPathSuggestion[];
  treatmentNodeKey: string | null;
  outcomeNodeKey: string | null;
};

function normalizeEdgeKey(edge: DraftDagPathEdgeInput) {
  return edge.edgeKey?.trim() || `${edge.sourceNodeKey}->${edge.targetNodeKey}`;
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function buildOutgoing(edges: DraftDagPathEdgeInput[]) {
  const outgoing = new Map<string, Array<{ edgeKey: string; targetNodeKey: string }>>();

  for (const edge of edges) {
    const edgeKey = normalizeEdgeKey(edge);
    const next = outgoing.get(edge.sourceNodeKey) ?? [];
    next.push({ edgeKey, targetNodeKey: edge.targetNodeKey });
    outgoing.set(edge.sourceNodeKey, next);
  }

  return outgoing;
}

function buildIncoming(edges: DraftDagPathEdgeInput[]) {
  const incoming = new Map<string, Array<{ edgeKey: string; sourceNodeKey: string }>>();

  for (const edge of edges) {
    const edgeKey = normalizeEdgeKey(edge);
    const next = incoming.get(edge.targetNodeKey) ?? [];
    next.push({ edgeKey, sourceNodeKey: edge.sourceNodeKey });
    incoming.set(edge.targetNodeKey, next);
  }

  return incoming;
}

function findReachableNodeKeys(startNodeKey: string, outgoing: Map<string, Array<{ edgeKey: string; targetNodeKey: string }>>) {
  const queue = [startNodeKey];
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const next of outgoing.get(current) ?? []) {
      if (visited.has(next.targetNodeKey)) {
        continue;
      }
      visited.add(next.targetNodeKey);
      queue.push(next.targetNodeKey);
    }
  }

  return uniqueSorted(visited);
}

function findReverseReachableNodeKeys(
  startNodeKey: string,
  incoming: Map<string, Array<{ edgeKey: string; sourceNodeKey: string }>>,
) {
  const queue = [startNodeKey];
  const visited = new Set<string>(queue);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const next of incoming.get(current) ?? []) {
      if (visited.has(next.sourceNodeKey)) {
        continue;
      }
      visited.add(next.sourceNodeKey);
      queue.push(next.sourceNodeKey);
    }
  }

  return uniqueSorted(visited);
}

function findDirectedShortestPath(input: {
  outgoing: Map<string, Array<{ edgeKey: string; targetNodeKey: string }>>;
  sourceNodeKey: string;
  targetNodeKey: string;
}) {
  const queue = [input.sourceNodeKey];
  const visited = new Set<string>(queue);
  const previous = new Map<string, { edgeKey: string; previousNodeKey: string }>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current === input.targetNodeKey) {
      break;
    }

    for (const next of input.outgoing.get(current) ?? []) {
      if (visited.has(next.targetNodeKey)) {
        continue;
      }
      visited.add(next.targetNodeKey);
      previous.set(next.targetNodeKey, {
        edgeKey: next.edgeKey,
        previousNodeKey: current,
      });
      queue.push(next.targetNodeKey);
    }
  }

  if (!visited.has(input.targetNodeKey)) {
    return {
      edgeKeys: [] as string[],
      exists: false,
      nodeKeys: [] as string[],
    };
  }

  const edgeKeys: string[] = [];
  const nodeKeys: string[] = [input.targetNodeKey];
  let currentNodeKey = input.targetNodeKey;

  while (currentNodeKey !== input.sourceNodeKey) {
    const step = previous.get(currentNodeKey);
    if (!step) {
      return {
        edgeKeys: [] as string[],
        exists: false,
        nodeKeys: [] as string[],
      };
    }

    edgeKeys.unshift(step.edgeKey);
    nodeKeys.unshift(step.previousNodeKey);
    currentNodeKey = step.previousNodeKey;
  }

  return {
    edgeKeys,
    exists: true,
    nodeKeys,
  };
}

function findDisconnectedNodeKeys(input: {
  edges: DraftDagPathEdgeInput[];
  nodeKeys: string[];
  outcomeNodeKey: string | null;
  treatmentNodeKey: string | null;
}) {
  if (!input.treatmentNodeKey && !input.outcomeNodeKey) {
    return [];
  }

  const undirected = new Map<string, string[]>();
  for (const nodeKey of input.nodeKeys) {
    undirected.set(nodeKey, []);
  }

  for (const edge of input.edges) {
    undirected.set(edge.sourceNodeKey, [...(undirected.get(edge.sourceNodeKey) ?? []), edge.targetNodeKey]);
    undirected.set(edge.targetNodeKey, [...(undirected.get(edge.targetNodeKey) ?? []), edge.sourceNodeKey]);
  }

  const anchorKeys = [input.treatmentNodeKey, input.outcomeNodeKey].filter(Boolean) as string[];
  const connectedToQuestion = new Set<string>();
  const queue = [...anchorKeys];

  for (const anchorKey of anchorKeys) {
    connectedToQuestion.add(anchorKey);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const next of undirected.get(current) ?? []) {
      if (connectedToQuestion.has(next)) {
        continue;
      }
      connectedToQuestion.add(next);
      queue.push(next);
    }
  }

  return input.nodeKeys.filter((nodeKey) => !connectedToQuestion.has(nodeKey));
}

function buildSuggestions(input: {
  edges: DraftDagPathEdgeInput[];
  nodes: DraftDagPathNodeInput[];
  outcomeNodeKey: string;
  reachableFromTreatmentNodeKeys: string[];
  reverseReachableToOutcomeNodeKeys: string[];
  treatmentNodeKey: string;
}) {
  const suggestions: DraftDagPathSuggestion[] = [];
  const existingEdgeKeys = new Set(input.edges.map((edge) => `${edge.sourceNodeKey}->${edge.targetNodeKey}`));
  const nodeByKey = new Map(input.nodes.map((node) => [node.nodeKey, node]));

  const addSuggestion = (suggestion: DraftDagPathSuggestion) => {
    if (
      suggestions.some(
        (existing) =>
          existing.message === suggestion.message &&
          existing.sourceNodeKey === suggestion.sourceNodeKey &&
          existing.targetNodeKey === suggestion.targetNodeKey,
      )
    ) {
      return;
    }

    suggestions.push(suggestion);
  };

  if (!existingEdgeKeys.has(`${input.treatmentNodeKey}->${input.outcomeNodeKey}`)) {
    addSuggestion({
      message: `Consider whether ${input.treatmentNodeKey} should point directly to ${input.outcomeNodeKey}.`,
      sourceNodeKey: input.treatmentNodeKey,
      targetNodeKey: input.outcomeNodeKey,
    });
  }

  const bridgeSources = input.reachableFromTreatmentNodeKeys.filter(
    (nodeKey) => nodeKey !== input.outcomeNodeKey,
  );
  const bridgeTargets = input.reverseReachableToOutcomeNodeKeys.filter(
    (nodeKey) => nodeKey !== input.treatmentNodeKey,
  );

  const rankedBridges: Array<{ score: number; sourceNodeKey: string; targetNodeKey: string }> = [];

  for (const sourceNodeKey of bridgeSources) {
    for (const targetNodeKey of bridgeTargets) {
      if (sourceNodeKey === targetNodeKey) {
        continue;
      }

      if (existingEdgeKeys.has(`${sourceNodeKey}->${targetNodeKey}`)) {
        continue;
      }

      const sourceNode = nodeByKey.get(sourceNodeKey);
      const targetNode = nodeByKey.get(targetNodeKey);
      const score =
        (sourceNodeKey === input.treatmentNodeKey ? 0 : 2) +
        (targetNodeKey === input.outcomeNodeKey ? 0 : 2) +
        (sourceNode?.nodeType === "mediator" ? -1 : 0) +
        (targetNode?.nodeType === "mediator" ? -1 : 0);

      rankedBridges.push({ score, sourceNodeKey, targetNodeKey });
    }
  }

  rankedBridges
    .sort((left, right) => left.score - right.score || `${left.sourceNodeKey}->${left.targetNodeKey}`.localeCompare(`${right.sourceNodeKey}->${right.targetNodeKey}`))
    .slice(0, 3)
    .forEach((bridge) => {
      addSuggestion({
        message: `Consider connecting ${bridge.sourceNodeKey} → ${bridge.targetNodeKey} to complete a treatment-to-outcome path.`,
        sourceNodeKey: bridge.sourceNodeKey,
        targetNodeKey: bridge.targetNodeKey,
      });
    });

  if (suggestions.length === 0) {
    addSuggestion({
      message: `Draw at least one directed path from ${input.treatmentNodeKey} toward ${input.outcomeNodeKey}.`,
    });
  }

  return suggestions.slice(0, 4);
}

export function analyzeDraftDagPaths(input: DraftDagPathAssistanceInput): DraftDagPathAssistance {
  const treatmentNodeKey = input.nodes.find((node) => node.nodeType === "treatment")?.nodeKey ?? null;
  const outcomeNodeKey = input.nodes.find((node) => node.nodeType === "outcome")?.nodeKey ?? null;
  const nodeKeys = input.nodes.map((node) => node.nodeKey);
  const outgoing = buildOutgoing(input.edges);
  const incoming = buildIncoming(input.edges);

  if (!treatmentNodeKey || !outcomeNodeKey) {
    return {
      canReachOutcomeNodeKeys: [],
      disconnectedNodeKeys: findDisconnectedNodeKeys({
        edges: input.edges,
        nodeKeys,
        outcomeNodeKey,
        treatmentNodeKey,
      }),
      outcomeNodeKey,
      pathEdgeKeys: [],
      pathExists: false,
      pathNodeKeys: [],
      reachableFromTreatmentNodeKeys: [],
      suggestions: [],
      treatmentNodeKey,
    };
  }

  const reachableFromTreatmentNodeKeys = findReachableNodeKeys(treatmentNodeKey, outgoing);
  const canReachOutcomeNodeKeys = findReverseReachableNodeKeys(outcomeNodeKey, incoming);
  const shortestPath = findDirectedShortestPath({
    outgoing,
    sourceNodeKey: treatmentNodeKey,
    targetNodeKey: outcomeNodeKey,
  });

  return {
    canReachOutcomeNodeKeys,
    disconnectedNodeKeys: uniqueSorted(
      findDisconnectedNodeKeys({
        edges: input.edges,
        nodeKeys,
        outcomeNodeKey,
        treatmentNodeKey,
      }),
    ),
    outcomeNodeKey,
    pathEdgeKeys: shortestPath.edgeKeys,
    pathExists: shortestPath.exists,
    pathNodeKeys: shortestPath.nodeKeys,
    reachableFromTreatmentNodeKeys,
    suggestions: shortestPath.exists
      ? []
      : buildSuggestions({
          edges: input.edges,
          nodes: input.nodes,
          outcomeNodeKey,
          reachableFromTreatmentNodeKeys,
          reverseReachableToOutcomeNodeKeys: canReachOutcomeNodeKeys,
          treatmentNodeKey,
        }),
    treatmentNodeKey,
  };
}
