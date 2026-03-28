export const AUDIT_TOOL_CALL_STATUSES = ["started", "completed", "error"] as const;

export type AuditToolCallStatus = (typeof AUDIT_TOOL_CALL_STATUSES)[number];

export type AuditToolCallLog = {
  completedAt: number | null;
  createdAt: number;
  errorMessage: string | null;
  id: string;
  parametersJson: string;
  promptId: string;
  resultSummary: string | null;
  status: AuditToolCallStatus;
  toolCallId: string;
  toolName: string;
};

export type AuditPromptLog = {
  createdAt: number;
  id: string;
  promptText: string;
  role: "intern" | "owner";
  sessionId: string;
  toolCalls: AuditToolCallLog[];
};

export type CreateAuditPromptResponse = {
  promptId: string;
};

export type ListAuditLogsResponse = {
  prompts: AuditPromptLog[];
};
