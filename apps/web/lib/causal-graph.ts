import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import {
  causalAssumptions,
  causalDagEdges,
  causalDagNodes,
  causalDataRequirements,
  causalDagVersions,
} from "@/lib/app-schema";

export type CausalDagExecutionGraph = {
  assumptions: Array<typeof causalAssumptions.$inferSelect>;
  dataRequirements: Array<typeof causalDataRequirements.$inferSelect>;
  edges: Array<typeof causalDagEdges.$inferSelect>;
  nodes: Array<typeof causalDagNodes.$inferSelect>;
  version: typeof causalDagVersions.$inferSelect;
};

export async function loadCausalDagExecutionGraph(input: {
  dagVersionId: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const versionRows = await db
    .select()
    .from(causalDagVersions)
    .where(
      and(
        eq(causalDagVersions.id, input.dagVersionId),
        eq(causalDagVersions.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const version = versionRows[0] ?? null;

  if (!version) {
    throw new Error("Causal DAG version not found.");
  }

  const [nodes, edges, assumptions, dataRequirements] = await Promise.all([
    db
      .select()
      .from(causalDagNodes)
      .where(eq(causalDagNodes.dagVersionId, version.id))
      .orderBy(asc(causalDagNodes.createdAt)),
    db
      .select()
      .from(causalDagEdges)
      .where(eq(causalDagEdges.dagVersionId, version.id))
      .orderBy(asc(causalDagEdges.createdAt)),
    db
      .select()
      .from(causalAssumptions)
      .where(eq(causalAssumptions.dagVersionId, version.id))
      .orderBy(asc(causalAssumptions.createdAt)),
    db
      .select()
      .from(causalDataRequirements)
      .where(eq(causalDataRequirements.dagVersionId, version.id))
      .orderBy(asc(causalDataRequirements.createdAt)),
  ]);

  return {
    assumptions,
    dataRequirements,
    edges,
    nodes,
    version,
  } satisfies CausalDagExecutionGraph;
}

export function deriveIdentificationPlan(graph: CausalDagExecutionGraph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const treatmentNode = graph.nodes.find((node) => node.nodeKey === graph.version.treatmentNodeKey) ?? null;
  const outcomeNode = graph.nodes.find((node) => node.nodeKey === graph.version.outcomeNodeKey) ?? null;

  if (!treatmentNode || !outcomeNode) {
    return {
      adjustmentSetNodeKeys: [] as string[],
      blockingReasons: ["Treatment or outcome node is missing from the DAG version."],
      identifiable: false,
      method: "none" as const,
      outcomeNode: outcomeNode,
      treatmentNode: treatmentNode,
    };
  }

  const parentsOf = (nodeId: string) =>
    graph.edges
      .filter((edge) => edge.targetNodeId === nodeId)
      .map((edge) => nodeById.get(edge.sourceNodeId))
      .filter((node): node is typeof graph.nodes[number] => Boolean(node));

  const treatmentParents = parentsOf(treatmentNode.id);
  const outcomeParents = parentsOf(outcomeNode.id);
  const outcomeParentIds = new Set(outcomeParents.map((node) => node.id));
  const sharedParents = treatmentParents.filter((node) => outcomeParentIds.has(node.id));

  const blockingReasons = sharedParents
    .filter((node) => node.observedStatus !== "observed")
    .map((node) => {
      if (node.observedStatus === "missing_external") {
        return `Identification blocked: ${node.label} is marked as missing external data.`;
      }

      return `Identification blocked: ${node.label} is unobserved.`;
    });

  return {
    adjustmentSetNodeKeys: sharedParents
      .filter((node) => node.observedStatus === "observed" && node.datasetColumnId)
      .map((node) => node.nodeKey),
    blockingReasons,
    identifiable: blockingReasons.length === 0,
    method: blockingReasons.length === 0 ? ("backdoor" as const) : ("none" as const),
    outcomeNode,
    treatmentNode,
  };
}
