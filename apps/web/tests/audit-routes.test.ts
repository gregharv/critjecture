import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createJsonRequest,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  chatTurnBelongsToUser: vi.fn(),
  createAssistantMessageLog: vi.fn(),
  createChatTurnLog: vi.fn(),
  finishChatTurnLog: vi.fn(),
  finishToolCallLog: vi.fn(),
  getSessionUser: vi.fn(),
  startToolCallLog: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/audit-log", () => ({
  chatTurnBelongsToUser: mocks.chatTurnBelongsToUser,
  createAssistantMessageLog: mocks.createAssistantMessageLog,
  createChatTurnLog: mocks.createChatTurnLog,
  finishChatTurnLog: mocks.finishChatTurnLog,
  finishToolCallLog: mocks.finishToolCallLog,
  startToolCallLog: mocks.startToolCallLog,
}));

import { POST as createChatTurn } from "@/app/api/audit/chat-turns/route";
import { POST as finishChatTurn } from "@/app/api/audit/chat-turns/finish/route";
import { POST as startToolCall } from "@/app/api/audit/tool-calls/start/route";
import { POST as finishToolCall } from "@/app/api/audit/tool-calls/finish/route";
import { POST as createAssistantMessage } from "@/app/api/audit/assistant-messages/route";

describe("audit routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.chatTurnBelongsToUser.mockResolvedValue(true);
    mocks.createChatTurnLog.mockResolvedValue({ turnId: "turn-1" });
    mocks.finishChatTurnLog.mockResolvedValue(undefined);
    mocks.startToolCallLog.mockResolvedValue(undefined);
    mocks.finishToolCallLog.mockResolvedValue(undefined);
    mocks.createAssistantMessageLog.mockResolvedValue(undefined);
  });

  it("requires authentication for chat turn creation", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await createChatTurn(createJsonRequest("http://localhost/api/audit/chat-turns", {
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      userPromptText: "What changed?",
    }));

    expect(response.status).toBe(401);
  });

  it("creates chat turns for authenticated users", async () => {
    const response = await createChatTurn(createJsonRequest("http://localhost/api/audit/chat-turns", {
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      userPromptText: "What changed?",
    }));

    expect(response.status).toBe(200);
    expect(mocks.createChatTurnLog).toHaveBeenCalledWith({
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      organizationId: "org-1",
      userId: "user-1",
      userPromptText: "What changed?",
      userRole: "owner",
    });
  });

  it("blocks finishing chat turns the user does not own", async () => {
    mocks.chatTurnBelongsToUser.mockResolvedValue(false);

    const response = await finishChatTurn(createJsonRequest("http://localhost/api/audit/chat-turns/finish", {
      status: "completed",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(404);
  });

  it("validates tool-call start payloads", async () => {
    const response = await startToolCall(createJsonRequest("http://localhost/api/audit/tool-calls/start", {
      runtimeToolCallId: "",
      toolName: "search_company_knowledge",
      toolParametersJson: "{}",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(400);
  });

  it("finishes tool calls for owned turns", async () => {
    const response = await finishToolCall(createJsonRequest("http://localhost/api/audit/tool-calls/finish", {
      accessedFiles: ["admin/contractors_2026.csv"],
      resultSummary: "Used file.",
      runtimeToolCallId: "call-1",
      status: "completed",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(200);
    expect(mocks.finishToolCallLog).toHaveBeenCalledWith({
      accessedFiles: ["admin/contractors_2026.csv"],
      errorMessage: null,
      resultSummary: "Used file.",
      runtimeToolCallId: "call-1",
      sandboxRunId: null,
      status: "completed",
      turnId: "turn-1",
    });
  });

  it("validates assistant message payloads and enforces ownership", async () => {
    mocks.chatTurnBelongsToUser.mockResolvedValue(false);

    const response = await createAssistantMessage(createJsonRequest("http://localhost/api/audit/assistant-messages", {
      messageIndex: 0,
      messageText: "Answer",
      messageType: "final-response",
      modelName: "gpt-5.4",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(404);
  });

  it("records assistant messages for owned turns", async () => {
    const response = await createAssistantMessage(createJsonRequest("http://localhost/api/audit/assistant-messages", {
      messageIndex: 0,
      messageText: "Answer",
      messageType: "final-response",
      modelName: "gpt-5.4",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(200);
    expect(mocks.createAssistantMessageLog).toHaveBeenCalledWith({
      messageIndex: 0,
      messageText: "Answer",
      messageType: "final-response",
      modelName: "gpt-5.4",
      turnId: "turn-1",
    });
  });

  it("returns 400 for invalid assistant message types", async () => {
    const response = await createAssistantMessage(createJsonRequest("http://localhost/api/audit/assistant-messages", {
      messageIndex: 0,
      messageText: "Answer",
      messageType: "other",
      modelName: "gpt-5.4",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: 'messageType must be "final-response" or "planner-selection".',
    });
  });
});
