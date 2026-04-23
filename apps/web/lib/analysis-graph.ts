import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import {
  analysisAssumptions,
  analysisGraphEdges,
  analysisGraphNodes,
  analysisDataRequirements,
  analysisGraphVersions,
} from "@/lib/app-schema";

export type AnalysisDagExecutionGraph = {
  assumptions: Array<typeof analysisAssumptions.$inferSelect>;
  dataRequirements: Array<typeof analysisDataRequirements.$inferSelect>;
  edges: Array<typeof analysisGraphEdges.$inferSelect>;
  nodes: Array<typeof analysisGraphNodes.$inferSelect>;
  version: typeof analysisGraphVersions.$inferSelect;
};

export async function loadAnalysisDagExecutionGraph(input: {
  dagVersionId: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const versionRows = await db
    .select()
    .from(analysisGraphVersions)
    .where(
      and(
        eq(analysisGraphVersions.id, input.dagVersionId),
        eq(analysisGraphVersions.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const version = versionRows[0] ?? null;

  if (!version) {
    throw new Error("Analysis DAG version not found.");
  }

  const [nodes, edges, assumptions, dataRequirements] = await Promise.all([
    db
      .select()
      .from(analysisGraphNodes)
      .where(eq(analysisGraphNodes.dagVersionId, version.id))
      .orderBy(asc(analysisGraphNodes.createdAt)),
    db
      .select()
      .from(analysisGraphEdges)
      .where(eq(analysisGraphEdges.dagVersionId, version.id))
      .orderBy(asc(analysisGraphEdges.createdAt)),
    db
      .select()
      .from(analysisAssumptions)
      .where(eq(analysisAssumptions.dagVersionId, version.id))
      .orderBy(asc(analysisAssumptions.createdAt)),
    db
      .select()
      .from(analysisDataRequirements)
      .where(eq(analysisDataRequirements.dagVersionId, version.id))
      .orderBy(asc(analysisDataRequirements.createdAt)),
  ]);

  return {
    assumptions,
    dataRequirements,
    edges,
    nodes,
    version,
  } satisfies AnalysisDagExecutionGraph;
}

export function deriveIdentificationPlan(graph: AnalysisDagExecutionGraph) {
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
