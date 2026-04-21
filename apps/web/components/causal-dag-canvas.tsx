"use client";

import "@xyflow/react/dist/style.css";

import { memo, useMemo } from "react";
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";

type DagDraftNode = {
  label: string;
  nodeKey: string;
  nodeType: string;
  observedStatus: string;
  sourceType: string;
};

type DagDraftEdge = {
  edgeKey: string;
  relationshipLabel: string;
  sourceNodeKey: string;
  targetNodeKey: string;
};

type CanvasSuggestedEdgeAction = {
  actionKey: string;
  label: string;
  sourceNodeKey: string;
  targetNodeKey: string;
};

type CausalDagCanvasProps = {
  disconnectedNodeKeys?: string[];
  edges: DagDraftEdge[];
  errorEdgeKeys?: string[];
  errorNodeKeys?: string[];
  nodes: DagDraftNode[];
  nodeSuggestedEdgeActions?: Record<string, CanvasSuggestedEdgeAction[]>;
  pathEdgeKeys?: string[];
  pathNodeKeys?: string[];
  onApplySuggestedEdge?: (input: { sourceNodeKey: string; targetNodeKey: string }) => void;
  onConnectEdge: (input: { sourceNodeKey: string; targetNodeKey: string }) => void;
  onMarkNodeAsOutcome?: (nodeKey: string) => void;
  onMarkNodeAsTreatment?: (nodeKey: string) => void;
  onRemoveEdge: (edgeKey: string) => void;
  onRemoveNode: (nodeKey: string) => void;
  onSelectEdge?: (edgeKey: string | null) => void;
  onSelectNode?: (nodeKey: string | null) => void;
  onUpdateEdgeLabel?: (input: { edgeKey: string; relationshipLabel: string }) => void;
  onUpdateNodePosition: (input: { nodeKey: string; x: number; y: number }) => void;
  positions: Record<string, { x: number; y: number }>;
  selectedEdgeKey?: string | null;
  selectedNodeKey?: string | null;
  warningEdgeKeys?: string[];
  warningNodeKeys?: string[];
};

type DagNodeData = {
  isDisconnected: boolean;
  isOnPrimaryPath: boolean;
  label: string;
  nodeKey: string;
  nodeType: string;
  observedStatus: string;
  onApplySuggestedEdge?: (input: { sourceNodeKey: string; targetNodeKey: string }) => void;
  onMarkAsOutcome?: (nodeKey: string) => void;
  onMarkAsTreatment?: (nodeKey: string) => void;
  onRemoveNode?: (nodeKey: string) => void;
  selected: boolean;
  severity: "none" | "warning" | "error";
  sourceType: string;
  suggestedEdgeActions: CanvasSuggestedEdgeAction[];
};

type DagEdgeData = {
  isOnPrimaryPath: boolean;
  onRemoveEdge?: (edgeKey: string) => void;
  onSelectEdge?: (edgeKey: string | null) => void;
  onUpdateEdgeLabel?: (input: { edgeKey: string; relationshipLabel: string }) => void;
  relationshipLabel: string;
  selected: boolean;
  severity: "none" | "warning" | "error";
};

type DagFlowNode = Node<DagNodeData, "dagNode">;

type DagFlowEdge = Edge<DagEdgeData, "dagEdge">;

export function getNodeAccent(nodeType: string) {
  switch (nodeType) {
    case "treatment":
      return "#2563eb";
    case "outcome":
      return "#16a34a";
    case "confounder":
      return "#ca8a04";
    case "mediator":
      return "#7c3aed";
    case "instrument":
      return "#db2777";
    case "latent":
      return "#475569";
    default:
      return "#0f172a";
  }
}

const canvasActionButtonStyle = {
  alignItems: "center",
  background: "#ffffff",
  border: "1px solid rgba(148, 163, 184, 0.5)",
  borderRadius: 8,
  color: "#0f172a",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: 11,
  fontWeight: 700,
  height: 26,
  justifyContent: "center",
  minWidth: 26,
  padding: "0 8px",
} as const;

const DagCanvasNode = memo(function DagCanvasNode({ data }: NodeProps<DagFlowNode>) {
  const accent = getNodeAccent(data.nodeType);
  const pathColor = "#0284c7";
  const severityColor =
    data.severity === "error"
      ? "#dc2626"
      : data.severity === "warning"
        ? "#d97706"
        : data.isOnPrimaryPath
          ? pathColor
          : accent;
  const backgroundColor =
    data.severity === "error"
      ? "#fef2f2"
      : data.severity === "warning"
        ? "#fffbeb"
        : data.isDisconnected
          ? "#f8fafc"
          : data.selected || data.isOnPrimaryPath
            ? "#eff6ff"
            : "#ffffff";

  return (
    <div
      style={{
        background: backgroundColor,
        border: `2px ${data.isDisconnected && data.severity === "none" ? "dashed" : "solid"} ${severityColor}`,
        borderRadius: 12,
        boxShadow: data.selected
          ? `0 0 0 4px ${colorMix(severityColor, 0.18)}, 0 10px 24px rgba(15, 23, 42, 0.10)`
          : `0 10px 24px ${colorMix(severityColor, data.severity === "none" ? 0.08 : 0.12)}`,
        minWidth: 180,
        padding: 12,
        position: "relative",
      }}
    >
      <Handle position={Position.Top} type="target" />
      <div style={{ display: "grid", gap: 6 }}>
        <strong style={{ color: "#0f172a", fontSize: 14 }}>{data.label || data.nodeKey}</strong>
        <span style={{ color: "#475569", fontSize: 12 }}>{data.nodeKey}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <span
            style={{
              background: colorMix(severityColor, 0.12),
              borderRadius: 999,
              color: severityColor,
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
            }}
          >
            {data.nodeType}
          </span>
          {data.selected ? (
            <span
              style={{
                background: "#dbeafe",
                borderRadius: 999,
                color: "#1d4ed8",
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
              }}
            >
              selected
            </span>
          ) : null}
          {data.severity !== "none" ? (
            <span
              style={{
                background: colorMix(severityColor, 0.12),
                borderRadius: 999,
                color: severityColor,
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
              }}
            >
              {data.severity}
            </span>
          ) : null}
          {data.isOnPrimaryPath ? (
            <span
              style={{
                background: colorMix(pathColor, 0.12),
                borderRadius: 999,
                color: pathColor,
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
              }}
            >
              path
            </span>
          ) : null}
          {data.isDisconnected ? (
            <span
              style={{
                background: "#e2e8f0",
                borderRadius: 999,
                color: "#475569",
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
              }}
            >
              disconnected
            </span>
          ) : null}
        </div>
        <span style={{ color: "#64748b", fontSize: 12 }}>
          {data.observedStatus} · {data.sourceType}
        </span>
        {data.selected ? (
          <div className="nodrag nopan" style={{ display: "grid", gap: 6, marginTop: 4 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button
                style={canvasActionButtonStyle}
                title="Mark node as treatment"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data.onMarkAsTreatment?.(data.nodeKey);
                }}
              >
                T
              </button>
              <button
                style={canvasActionButtonStyle}
                title="Mark node as outcome"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data.onMarkAsOutcome?.(data.nodeKey);
                }}
              >
                Y
              </button>
              <button
                style={{ ...canvasActionButtonStyle, color: "#b91c1c" }}
                title="Remove node"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data.onRemoveNode?.(data.nodeKey);
                }}
              >
                ×
              </button>
            </div>
            {data.suggestedEdgeActions.length > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "#0369a1", fontSize: 11, fontWeight: 700 }}>
                  Quick-add suggested links
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {data.suggestedEdgeActions.slice(0, 2).map((action) => (
                    <button
                      key={action.actionKey}
                      style={{
                        ...canvasActionButtonStyle,
                        border: "1px solid rgba(2, 132, 199, 0.35)",
                        color: "#0369a1",
                        maxWidth: 160,
                      }}
                      title={action.label}
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        data.onApplySuggestedEdge?.({
                          sourceNodeKey: action.sourceNodeKey,
                          targetNodeKey: action.targetNodeKey,
                        });
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Handle position={Position.Bottom} type="source" />
    </div>
  );
});

const DagCanvasEdge = memo(function DagCanvasEdge({
  data,
  id,
  markerEnd,
  selected,
  sourceX,
  sourceY,
  sourcePosition,
  style,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<DagFlowEdge>) {
  const pathColor = "#0284c7";
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            left: labelX,
            position: "absolute",
            top: labelY,
            transform: "translate(-50%, -50%)",
            zIndex: 10,
          }}
        >
          {selected ? (
            <div
              style={{
                alignItems: "center",
                background:
                  data?.severity === "error"
                    ? "#fef2f2"
                    : data?.severity === "warning"
                      ? "#fffbeb"
                      : data?.isOnPrimaryPath
                        ? "#eff6ff"
                        : "#ffffff",
                border:
                  data?.severity === "error"
                    ? "1px solid rgba(220, 38, 38, 0.35)"
                    : data?.severity === "warning"
                      ? "1px solid rgba(217, 119, 6, 0.35)"
                      : data?.isOnPrimaryPath
                        ? `1px solid ${colorMix(pathColor, 0.45)}`
                        : "1px solid rgba(37, 99, 235, 0.35)",
                borderRadius: 12,
                boxShadow: "0 8px 16px rgba(15, 23, 42, 0.12)",
                display: "flex",
                gap: 6,
                padding: 6,
              }}
            >
              <input
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.5)",
                  borderRadius: 8,
                  fontSize: 12,
                  minWidth: 120,
                  padding: "4px 8px",
                }}
                value={data?.relationshipLabel ?? ""}
                onChange={(event) =>
                  data?.onUpdateEdgeLabel?.({
                    edgeKey: id,
                    relationshipLabel: event.target.value,
                  })
                }
                onClick={(event) => event.stopPropagation()}
              />
              <button
                style={{ ...canvasActionButtonStyle, color: "#b91c1c" }}
                title="Remove edge"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  data?.onRemoveEdge?.(id);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <button
              style={{
                background:
                  data?.severity === "error"
                    ? "#fef2f2"
                    : data?.severity === "warning"
                      ? "#fffbeb"
                      : data?.isOnPrimaryPath
                        ? "#eff6ff"
                        : "#ffffff",
                border:
                  data?.severity === "error"
                    ? "1px solid rgba(220, 38, 38, 0.45)"
                    : data?.severity === "warning"
                      ? "1px solid rgba(217, 119, 6, 0.45)"
                      : data?.isOnPrimaryPath
                        ? `1px solid ${colorMix(pathColor, 0.45)}`
                        : "1px solid rgba(148, 163, 184, 0.45)",
                borderRadius: 999,
                color:
                  data?.severity === "error"
                    ? "#b91c1c"
                    : data?.severity === "warning"
                      ? "#b45309"
                      : data?.isOnPrimaryPath
                        ? pathColor
                        : "#475569",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 10px",
              }}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                data?.onSelectEdge?.(id);
              }}
            >
              {data?.relationshipLabel || "causes"}
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

const NODE_TYPES = {
  dagNode: DagCanvasNode,
};

const EDGE_TYPES = {
  dagEdge: DagCanvasEdge,
};

function colorMix(hex: string, alpha: number) {
  const sanitized = hex.replace("#", "");
  const red = Number.parseInt(sanitized.slice(0, 2), 16);
  const green = Number.parseInt(sanitized.slice(2, 4), 16);
  const blue = Number.parseInt(sanitized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getFallbackPosition(index: number) {
  const columns = 4;
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: 40 + column * 240,
    y: 40 + row * 160,
  };
}

export function CausalDagCanvas(props: CausalDagCanvasProps) {
  const disconnectedNodeKeySet = useMemo(
    () => new Set(props.disconnectedNodeKeys ?? []),
    [props.disconnectedNodeKeys],
  );
  const errorNodeKeySet = useMemo(() => new Set(props.errorNodeKeys ?? []), [props.errorNodeKeys]);
  const warningNodeKeySet = useMemo(() => new Set(props.warningNodeKeys ?? []), [props.warningNodeKeys]);
  const errorEdgeKeySet = useMemo(() => new Set(props.errorEdgeKeys ?? []), [props.errorEdgeKeys]);
  const pathNodeKeySet = useMemo(() => new Set(props.pathNodeKeys ?? []), [props.pathNodeKeys]);
  const pathEdgeKeySet = useMemo(() => new Set(props.pathEdgeKeys ?? []), [props.pathEdgeKeys]);
  const warningEdgeKeySet = useMemo(() => new Set(props.warningEdgeKeys ?? []), [props.warningEdgeKeys]);

  const flowNodes = useMemo<Array<DagFlowNode>>(
    () =>
      props.nodes.map((node, index) => ({
        data: {
          isDisconnected: disconnectedNodeKeySet.has(node.nodeKey),
          isOnPrimaryPath: pathNodeKeySet.has(node.nodeKey),
          label: node.label,
          nodeKey: node.nodeKey,
          nodeType: node.nodeType,
          observedStatus: node.observedStatus,
          onApplySuggestedEdge: props.onApplySuggestedEdge,
          onMarkAsOutcome: props.onMarkNodeAsOutcome,
          onMarkAsTreatment: props.onMarkNodeAsTreatment,
          onRemoveNode: props.onRemoveNode,
          selected: props.selectedNodeKey === node.nodeKey,
          severity: errorNodeKeySet.has(node.nodeKey)
            ? "error"
            : warningNodeKeySet.has(node.nodeKey)
              ? "warning"
              : "none",
          sourceType: node.sourceType,
          suggestedEdgeActions: props.nodeSuggestedEdgeActions?.[node.nodeKey] ?? [],
        },
        draggable: true,
        id: node.nodeKey,
        position: props.positions[node.nodeKey] ?? getFallbackPosition(index),
        type: "dagNode",
      })),
    [
      disconnectedNodeKeySet,
      errorNodeKeySet,
      pathNodeKeySet,
      props.nodeSuggestedEdgeActions,
      props.nodes,
      props.onApplySuggestedEdge,
      props.onMarkNodeAsOutcome,
      props.onMarkNodeAsTreatment,
      props.onRemoveNode,
      props.positions,
      props.selectedNodeKey,
      warningNodeKeySet,
    ],
  );

  const flowEdges = useMemo<Array<DagFlowEdge>>(
    () =>
      props.edges.map((edge) => {
        const selected = props.selectedEdgeKey === edge.edgeKey;

        return {
          animated: pathEdgeKeySet.has(edge.edgeKey),
          data: {
            isOnPrimaryPath: pathEdgeKeySet.has(edge.edgeKey),
            onRemoveEdge: props.onRemoveEdge,
            onSelectEdge: props.onSelectEdge,
            onUpdateEdgeLabel: props.onUpdateEdgeLabel,
            relationshipLabel: edge.relationshipLabel,
            selected,
            severity: errorEdgeKeySet.has(edge.edgeKey)
              ? "error"
              : warningEdgeKeySet.has(edge.edgeKey)
                ? "warning"
                : "none",
          },
          id: edge.edgeKey,
          markerEnd: {
            color: errorEdgeKeySet.has(edge.edgeKey)
              ? "#dc2626"
              : warningEdgeKeySet.has(edge.edgeKey)
                ? "#d97706"
                : pathEdgeKeySet.has(edge.edgeKey)
                  ? "#0284c7"
                  : selected
                    ? "#2563eb"
                    : "#64748b",
            type: MarkerType.ArrowClosed,
          },
          selected,
          source: edge.sourceNodeKey,
          style: {
            stroke: errorEdgeKeySet.has(edge.edgeKey)
              ? "#dc2626"
              : warningEdgeKeySet.has(edge.edgeKey)
                ? "#d97706"
                : pathEdgeKeySet.has(edge.edgeKey)
                  ? "#0284c7"
                  : selected
                    ? "#2563eb"
                    : "#64748b",
            strokeDasharray: pathEdgeKeySet.has(edge.edgeKey) ? "6 4" : undefined,
            strokeWidth: errorEdgeKeySet.has(edge.edgeKey) || selected || pathEdgeKeySet.has(edge.edgeKey) ? 3 : 2,
          },
          target: edge.targetNodeKey,
          type: "dagEdge",
        } satisfies DagFlowEdge;
      }),
    [
      errorEdgeKeySet,
      pathEdgeKeySet,
      props.edges,
      props.onRemoveEdge,
      props.onSelectEdge,
      props.onUpdateEdgeLabel,
      props.selectedEdgeKey,
      warningEdgeKeySet,
    ],
  );

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    props.onConnectEdge({
      sourceNodeKey: connection.source,
      targetNodeKey: connection.target,
    });
  }

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(248, 250, 252, 0.9) 0%, rgba(241, 245, 249, 0.9) 100%)",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        borderRadius: 16,
        height: 520,
        overflow: "hidden",
      }}
    >
      <ReactFlow
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{
          markerEnd: {
            type: MarkerType.ArrowClosed,
          },
        }}
        edgeTypes={EDGE_TYPES}
        edges={flowEdges}
        fitView
        minZoom={0.2}
        nodeTypes={NODE_TYPES}
        nodes={flowNodes}
        onConnect={handleConnect}
        onEdgeClick={(_, edge) => {
          props.onSelectNode?.(null);
          props.onSelectEdge?.(edge.id);
        }}
        onEdgeDoubleClick={(_, edge) => props.onRemoveEdge(edge.id)}
        onEdgesDelete={(edges) => {
          for (const edge of edges) {
            props.onRemoveEdge(edge.id);
          }
        }}
        onNodeClick={(_, node) => {
          props.onSelectEdge?.(null);
          props.onSelectNode?.(node.id);
        }}
        onNodeDragStop={(_, node) => {
          props.onSelectEdge?.(null);
          props.onSelectNode?.(node.id);
          props.onUpdateNodePosition({
            nodeKey: node.id,
            x: node.position.x,
            y: node.position.y,
          });
        }}
        onNodesDelete={(nodes) => {
          for (const node of nodes) {
            props.onRemoveNode(node.id);
          }
        }}
        onPaneClick={() => {
          props.onSelectNode?.(null);
          props.onSelectEdge?.(null);
        }}
      >
        <MiniMap
          pannable
          style={{ background: "#f8fafc" }}
          zoomable
        />
        <Controls />
        <Background color="#cbd5e1" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
