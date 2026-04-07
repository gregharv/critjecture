import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCsvSchemas,
  cleanupExpiredAnalysisResults,
  getStoredAnalysisResult,
  storeAnalysisResult,
} from "@/lib/analysis-results";
import { createChatTurnLog } from "@/lib/audit-log";
import { getAppDatabase, resetAppDatabaseForTests } from "@/lib/app-db";
import { analysisResults } from "@/lib/app-schema";
import { uploadKnowledgeFile } from "@/lib/knowledge-files";
import { ensureSeedState, getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";
import { eq } from "drizzle-orm";

describe("analysis-results integration", () => {
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

  it("persists and reloads analysis results across database reopen", async () => {
    const owner = await getAuthenticatedUserByEmail("owner@example.com");

    expect(owner).not.toBeNull();

    const turn = await createChatTurnLog({
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      organizationId: owner!.organizationId,
      userId: owner!.id,
      userPromptText: "Show me contractor payouts.",
      userRole: owner!.role,
    });

    const stored = await storeAnalysisResult({
      chart: {
        chartType: "bar",
        title: "Contractor payouts",
        x: ["Acme", "Beacon"],
        xLabel: "Contractor",
        y: [1200, 900],
        yLabel: "Payout",
      },
      csvSchemas: [
        {
          columns: ["ledger_year", "contractor", "payout"],
          file: "admin/contractors_2026.csv",
        },
      ],
      inputFiles: ["admin/contractors_2026.csv"],
      organizationId: owner!.organizationId,
      turnId: turn.turnId,
      userId: owner!.id,
    });

    await resetAppDatabaseForTests();

    const reloaded = await getStoredAnalysisResult({
      analysisResultId: stored.id,
      organizationId: owner!.organizationId,
      turnId: turn.turnId,
      userId: owner!.id,
    });

    expect(reloaded).not.toBeNull();
    expect(reloaded?.chart).toEqual(stored.chart);
    expect(reloaded?.csvSchemas).toEqual(stored.csvSchemas);
    expect(reloaded?.inputFiles).toEqual(["admin/contractors_2026.csv"]);
  });

  it("builds CSV schemas correctly for carriage-return-only CSV files", async () => {
    const owner = await getAuthenticatedUserByEmail("owner@example.com");

    expect(owner).not.toBeNull();

    const uploaded = await uploadKnowledgeFile({
      file: new File([
        "Region,Product Name,Sales\rWest,Product Beta,250\rEast,Product Desk,300\r",
      ], "superstore-sales.csv", { type: "text/csv" }),
      requestedScope: "public",
      user: owner!,
    });

    expect(uploaded.ingestionStatus).toBe("ready");

    const csvSchemas = await buildCsvSchemas({
      inputFiles: [uploaded.sourcePath],
      organizationId: owner!.organizationId,
      organizationSlug: owner!.organizationSlug,
      role: owner!.role,
    });

    expect(csvSchemas).toEqual([
      {
        columns: ["Region", "Product Name", "Sales"],
        file: uploaded.sourcePath,
      },
    ]);
  });

  it("rejects lookups when org, user, or turn do not match", async () => {
    const owner = await getAuthenticatedUserByEmail("owner@example.com");
    const intern = await getAuthenticatedUserByEmail("intern@example.com");

    expect(owner).not.toBeNull();
    expect(intern).not.toBeNull();

    const turn = await createChatTurnLog({
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      organizationId: owner!.organizationId,
      userId: owner!.id,
      userPromptText: "Show me contractor payouts.",
      userRole: owner!.role,
    });
    const otherTurn = await createChatTurnLog({
      chatSessionId: "session-2",
      conversationId: "conversation-1",
      organizationId: owner!.organizationId,
      userId: owner!.id,
      userPromptText: "Show me something else.",
      userRole: owner!.role,
    });

    const stored = await storeAnalysisResult({
      chart: {
        chartType: "bar",
        title: "Contractor payouts",
        x: ["Acme"],
        xLabel: "Contractor",
        y: [1200],
        yLabel: "Payout",
      },
      csvSchemas: [],
      inputFiles: ["admin/contractors_2026.csv"],
      organizationId: owner!.organizationId,
      turnId: turn.turnId,
      userId: owner!.id,
    });

    await expect(
      getStoredAnalysisResult({
        analysisResultId: stored.id,
        organizationId: "org-other",
        turnId: turn.turnId,
        userId: owner!.id,
      }),
    ).resolves.toBeNull();
    await expect(
      getStoredAnalysisResult({
        analysisResultId: stored.id,
        organizationId: owner!.organizationId,
        turnId: turn.turnId,
        userId: intern!.id,
      }),
    ).resolves.toBeNull();
    await expect(
      getStoredAnalysisResult({
        analysisResultId: stored.id,
        organizationId: owner!.organizationId,
        turnId: otherTurn.turnId,
        userId: owner!.id,
      }),
    ).resolves.toBeNull();
  });

  it("cleans up expired rows", async () => {
    const owner = await getAuthenticatedUserByEmail("owner@example.com");

    expect(owner).not.toBeNull();

    const turn = await createChatTurnLog({
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      organizationId: owner!.organizationId,
      userId: owner!.id,
      userPromptText: "Show me contractor payouts.",
      userRole: owner!.role,
    });
    const stored = await storeAnalysisResult({
      chart: {
        chartType: "bar",
        title: "Contractor payouts",
        x: ["Acme"],
        xLabel: "Contractor",
        y: [1200],
        yLabel: "Payout",
      },
      csvSchemas: [],
      inputFiles: ["admin/contractors_2026.csv"],
      organizationId: owner!.organizationId,
      turnId: turn.turnId,
      userId: owner!.id,
    });
    const db = await getAppDatabase();

    await db
      .update(analysisResults)
      .set({
        expiresAt: Date.now() - 1,
      })
      .where(eq(analysisResults.id, stored.id));

    await cleanupExpiredAnalysisResults();

    const reloaded = await getStoredAnalysisResult({
      analysisResultId: stored.id,
      organizationId: owner!.organizationId,
      turnId: turn.turnId,
      userId: owner!.id,
    });

    expect(reloaded).toBeNull();
  });

  it("rejects chart-ready payloads that exceed point-count limits", async () => {
    const owner = await getAuthenticatedUserByEmail("owner@example.com");

    expect(owner).not.toBeNull();

    const turn = await createChatTurnLog({
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      organizationId: owner!.organizationId,
      userId: owner!.id,
      userPromptText: "Show me contractor payouts.",
      userRole: owner!.role,
    });

    await expect(
      storeAnalysisResult({
        chart: {
          chartType: "line",
          title: "Too many points",
          x: Array.from({ length: 2_001 }, (_, index) => index),
          xLabel: "Index",
          y: Array.from({ length: 2_001 }, (_, index) => index),
          yLabel: "Value",
        },
        csvSchemas: [],
        inputFiles: ["admin/contractors_2026.csv"],
        organizationId: owner!.organizationId,
        turnId: turn.turnId,
        userId: owner!.id,
      }),
    ).rejects.toMatchObject({
      code: "point_count_limit",
      name: "AnalysisResultValidationError",
    });
  });

  it("rejects chart-ready payloads that exceed byte-size limits", async () => {
    const owner = await getAuthenticatedUserByEmail("owner@example.com");

    expect(owner).not.toBeNull();

    const turn = await createChatTurnLog({
      chatSessionId: "session-1",
      conversationId: "conversation-1",
      organizationId: owner!.organizationId,
      userId: owner!.id,
      userPromptText: "Show me contractor payouts.",
      userRole: owner!.role,
    });

    await expect(
      storeAnalysisResult({
        chart: {
          chartType: "bar",
          title: "Large payload",
          x: ["x".repeat(300_000)],
          xLabel: "Contractor",
          y: [1],
          yLabel: "Payout",
        },
        csvSchemas: [],
        inputFiles: ["admin/contractors_2026.csv"],
        organizationId: owner!.organizationId,
        turnId: turn.turnId,
        userId: owner!.id,
      }),
    ).rejects.toMatchObject({
      code: "payload_bytes_limit",
      name: "AnalysisResultValidationError",
    });
  });
});
