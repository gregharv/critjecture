import type {
  WorkflowDeliveryV1,
  WorkflowExecutionIdentityV1,
  WorkflowInputBindingsV1,
  WorkflowInputContractV1,
  WorkflowOutputsV1,
  WorkflowProvenanceV1,
  WorkflowRecipeV1,
  WorkflowScheduleV1,
  WorkflowStatus,
  WorkflowThresholdsV1,
  WorkflowVisibility,
} from "@/lib/workflow-types";

export type WorkflowDraftVersionPayload = {
  delivery: WorkflowDeliveryV1;
  executionIdentity: WorkflowExecutionIdentityV1;
  inputBindings: WorkflowInputBindingsV1;
  inputContract: WorkflowInputContractV1;
  outputs: WorkflowOutputsV1;
  provenance: WorkflowProvenanceV1;
  recipe: WorkflowRecipeV1;
  schedule: WorkflowScheduleV1;
  thresholds: WorkflowThresholdsV1;
};

export type WorkflowDraftFromChatTurn = {
  conversationId: string;
  inputFilePaths: string[];
  sourceSummary: {
    analysisToolCallCount: number;
    chartToolCallCount: number;
    documentToolCallCount: number;
    sandboxRunIds: string[];
    selectedToolCallIds: string[];
  };
  status: WorkflowStatus;
  suggestedDescription: string | null;
  suggestedName: string;
  turnId: string;
  unresolvedInputPaths: string[];
  version: WorkflowDraftVersionPayload;
  visibility: WorkflowVisibility;
};

export type BuildWorkflowFromChatTurnResponse = {
  draft: WorkflowDraftFromChatTurn;
};
