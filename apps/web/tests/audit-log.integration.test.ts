import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chatTurnBelongsToUser,
  createAssistantMessageLog,
  createChatTurnLog,
  finishChatTurnLog,
  finishToolCallLog,
  listRecentChatTurnLogs,
  startToolCallLog,
} from "@/lib/audit-log";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { ensureSeedState } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

describe("audit-log integration", () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    const env = await createTestAppEnvironment();
    cleanup = env.cleanup;
    await ensureSeedState();
  });

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("persists chat turns, tool calls, and assistant messages in timeline order", async () => {
    const owner = await getAuthenticatedUserByEmail("owner@example.com");

    expect(owner).not.toBeNull();

    const turn = await createChatTurnLog({
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      organizationId: owner!.organizationId,
      userId: owner!.id,
      userPromptText: "What changed?",
      userRole: owner!.role,
    });

    await startToolCallLog({
      runtimeToolCallId: "call-1",
      toolName: "search_company_knowledge",
      toolParametersJson: JSON.stringify({ query: "contractors" }),
      turnId: turn.turnId,
    });
    await finishToolCallLog({
      accessedFiles: ["admin/contractors_2026.csv", "admin/contractors_2026.csv"],
      resultSummary: "Selected contractors file.",
      runtimeToolCallId: "call-1",
      status: "completed",
      turnId: turn.turnId,
    });
    await createAssistantMessageLog({
      messageIndex: 0,
      messageText: "I found the contractor ledger.",
      messageType: "final-response",
      modelName: "gpt-5.4",
      turnId: turn.turnId,
    });
    await finishChatTurnLog({
      status: "completed",
      turnId: turn.turnId,
    });

    const belongsToOwner = await chatTurnBelongsToUser(
      turn.turnId,
      owner!.id,
      owner!.organizationId,
    );
    const turns = await listRecentChatTurnLogs(owner!.organizationId, 10);

    expect(belongsToOwner).toBe(true);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.status).toBe("completed");
    expect(turns[0]?.toolCalls[0]?.accessedFiles).toEqual(["admin/contractors_2026.csv"]);
    expect(turns[0]?.assistantMessages[0]?.messageText).toBe("I found the contractor ledger.");
    expect(turns[0]?.userEmail).toBe("owner@example.com");
  });
});
