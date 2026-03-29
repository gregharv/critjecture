export const TURN_STATUSES = ["started", "completed", "failed"] as const;
export const TOOL_CALL_STATUSES = ["started", "completed", "error"] as const;
export const ASSISTANT_MESSAGE_TYPES = [
  "final-response",
  "planner-selection",
] as const;

export type TurnStatus = (typeof TURN_STATUSES)[number];
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];
export type AssistantMessageType = (typeof ASSISTANT_MESSAGE_TYPES)[number];

export type ToolCallLog = {
  accessedFiles: string[];
  completedAt: number | null;
  startedAt: number;
  errorMessage: string | null;
  id: string;
  toolParametersJson: string;
  turnId: string;
  resultSummary: string | null;
  status: ToolCallStatus;
  runtimeToolCallId: string;
  toolName: string;
};

export type AssistantMessageLog = {
  createdAt: number;
  id: string;
  messageIndex: number;
  messageText: string;
  messageType: AssistantMessageType;
  modelName: string;
  turnId: string;
};

export type RetrievalRunLog = {
  completedAt: number | null;
  embeddingModel: string | null;
  errorMessage: string | null;
  id: string;
  pipelineVersion: string;
  rerankModel: string | null;
  startedAt: number;
  status: TurnStatus;
  turnId: string;
};

export type ResponseCitationLog = {
  assistantMessageId: string;
  citationIndex: number;
  id: string;
  retrievalCandidateId: string;
};

export type ChatTurnLog = {
  assistantMessages: AssistantMessageLog[];
  chatSessionId: string;
  completedAt: number | null;
  conversationId: string;
  createdAt: number;
  id: string;
  responseCitations: ResponseCitationLog[];
  retrievalRuns: RetrievalRunLog[];
  status: TurnStatus;
  toolCalls: ToolCallLog[];
  userPromptText: string;
  userEmail: string | null;
  userId: string | null;
  userName: string | null;
  userRole: "intern" | "owner";
};

export type CreateChatTurnResponse = {
  turnId: string;
};

export type FinishChatTurnResponse = {
  ok: true;
};

export type ListChatTurnLogsResponse = {
  turns: ChatTurnLog[];
};
