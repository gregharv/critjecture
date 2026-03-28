export const AUDIT_TOOL_CALL_STATUSES = ["started", "completed", "error"] as const;

export type AuditToolCallStatus = (typeof AUDIT_TOOL_CALL_STATUSES)[number];

export type AuditToolCallLog = {
  accessedFiles: string[];
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

export const AUDIT_TRACE_EVENT_KINDS = [
  "assistant-text",
  "assistant-thinking",
  "assistant-tool-plan",
  "tool-call",
  "tool-result",
] as const;

export type AuditTraceEventKind = (typeof AUDIT_TRACE_EVENT_KINDS)[number];

export type AuditTraceEventLog = {
  content: string;
  createdAt: number;
  id: string;
  kind: AuditTraceEventKind;
  promptId: string;
  title: string;
};

export type AuditPromptLog = {
  createdAt: number;
  id: string;
  promptText: string;
  role: "intern" | "owner";
  sessionId: string;
  traceEvents: AuditTraceEventLog[];
  toolCalls: AuditToolCallLog[];
};

export type CreateAuditPromptResponse = {
  promptId: string;
};

export type ListAuditLogsResponse = {
  prompts: AuditPromptLog[];
};
