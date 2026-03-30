import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { requestLogs } from "@/lib/app-schema";
import { beginObservedRequest, finalizeObservedRequest } from "@/lib/operations";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("operations observability", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("persists correlation fields and attaches the request id header", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const db = await getAppDatabase();
      const user = await getAuthenticatedUserByEmail("owner@example.com");

      expect(user).not.toBeNull();

      const observed = beginObservedRequest({
        correlation: {
          governanceJobId: "gov-1",
        },
        method: "POST",
        routeGroup: "governance",
        routeKey: "governance.jobs.create",
        user,
      });

      const response = await finalizeObservedRequest(observed, {
        governanceJobId: "gov-1",
        knowledgeImportJobId: "import-1",
        metadata: {
          source: "test",
        },
        outcome: "ok",
        response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
        runtimeToolCallId: "tool-1",
        sandboxRunId: "run-1",
        toolName: "generate_document",
        totalCostUsd: 1.25,
        totalTokens: 42,
        turnId: "turn-1",
      });

      expect(response.headers.get("x-critjecture-request-id")).toBe(observed.requestId);

      const rows = await db
        .select()
        .from(requestLogs)
        .where(eq(requestLogs.requestId, observed.requestId));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        governanceJobId: "gov-1",
        knowledgeImportJobId: "import-1",
        requestId: observed.requestId,
        routeGroup: "governance",
        routeKey: "governance.jobs.create",
        runtimeToolCallId: "tool-1",
        sandboxRunId: "run-1",
        toolName: "generate_document",
        turnId: "turn-1",
        totalCostUsd: 1.25,
        totalTokens: 42,
      });
    } finally {
      await environment.cleanup();
    }
  });
});
