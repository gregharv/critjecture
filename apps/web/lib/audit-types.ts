export const TOOL_CALL_STATUSES = ["started", "completed", "error"] as const;

export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

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
  messageText: string;
  messageTitle: string;
  turnId: string;
};

export type ChatTurnLog = {
  assistantMessages: AssistantMessageLog[];
  chatSessionId: string;
  createdAt: number;
  id: string;
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

export type ListChatTurnLogsResponse = {
  turns: ChatTurnLog[];
};
