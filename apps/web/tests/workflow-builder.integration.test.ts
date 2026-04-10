import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import {
  analysisResults,
  chatTurns,
  documents,
  toolCalls,
} from "@/lib/app-schema";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { buildWorkflowDraftFromChatTurn } from "@/lib/workflow-builder";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("workflow builder integration", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("builds a workflow draft from a completed chat turn with managed input documents", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");

      expect(owner).not.toBeNull();

      const db = await getAppDatabase();
      const now = Date.now();
      const turnId = randomUUID();
      const runtimeToolCallId = `rtc-${randomUUID()}`;
      const sourcePath = "public/uploads/sales.csv";
      const documentId = randomUUID();

      await db.insert(chatTurns).values({
        chatSessionId: `session-${randomUUID()}`,
        completedAt: now,
        conversationId: `conversation-${randomUUID()}`,
        createdAt: now,
        id: turnId,
        organizationId: owner!.organizationId,
        status: "completed",
        userId: owner!.id,
        userPromptText: "Summarize weekly sales performance and highlight any drop.",
        userRole: "owner",
      });

      await db.insert(documents).values({
        accessScope: "public",
        byteSize: 128,
        contentSha256: `sha-${randomUUID()}`,
        createdAt: now,
        displayName: "sales.csv",
        id: documentId,
        ingestionError: null,
        ingestionStatus: "ready",
        lastIndexedAt: now,
        mimeType: "text/csv",
        organizationId: owner!.organizationId,
        sourcePath,
        sourceType: "uploaded",
        updatedAt: now,
        uploadedByUserId: owner!.id,
      });

      await db.insert(toolCalls).values({
        accessedFilesJson: JSON.stringify([sourcePath]),
        completedAt: now,
        errorMessage: null,
        id: randomUUID(),
        resultSummary: "Generated weekly sales summary.",
        runtimeToolCallId,
        sandboxRunId: null,
        startedAt: now,
        status: "completed",
        toolName: "run_data_analysis",
        toolParametersJson: JSON.stringify({
          code: "print('ok')",
          inputFiles: [sourcePath],
        }),
        turnId,
      });

      await db.insert(analysisResults).values({
        chartJson: JSON.stringify({
          chartType: "line",
          title: "Sales trend",
          x: ["2026-01-01"],
          y: [10],
        }),
        createdAt: now,
        csvSchemasJson: JSON.stringify([
          {
            columns: ["date", "amount"],
            file: sourcePath,
          },
        ]),
        expiresAt: now + 60_000,
        id: randomUUID(),
        inputFilesJson: JSON.stringify([sourcePath]),
        organizationId: owner!.organizationId,
        payloadBytes: 64,
        pointCount: 1,
        turnId,
        userId: owner!.id,
      });

      const response = await buildWorkflowDraftFromChatTurn({
        organizationId: owner!.organizationId,
        turnId,
        userId: owner!.id,
      });

      expect(response.draft.turnId).toBe(turnId);
      expect(response.draft.sourceSummary.analysisToolCallCount).toBe(1);
      expect(response.draft.version.recipe.steps).toHaveLength(1);
      expect(response.draft.unresolvedInputPaths).toEqual([]);

      const firstInput = response.draft.version.inputContract.inputs[0];
      expect(firstInput).toMatchObject({
        data_kind: "table",
        required: true,
      });
      expect(firstInput?.csv_rules?.required_columns).toEqual(["date", "amount"]);

      const firstBinding = response.draft.version.inputBindings.bindings[0];
      expect(firstBinding?.binding.kind).toBe("document_id");

      if (firstBinding?.binding.kind !== "document_id") {
        throw new Error("Expected document_id binding.");
      }

      expect(firstBinding.binding.document_id).toBe(documentId);
    } finally {
      await environment.cleanup();
    }
  });
});
