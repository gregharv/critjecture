import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createJsonRequest,
  createRateLimitDecision,
  createSearchResult,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-1" })),
  enforceRateLimitPolicy: vi.fn(),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getSessionUser: vi.fn(),
  runOperationsMaintenance: vi.fn(),
  searchCompanyKnowledge: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/company-knowledge", () => ({
  searchCompanyKnowledge: mocks.searchCompanyKnowledge,
}));

vi.mock("@/lib/operations", async () => {
  const { NextResponse } = await import("next/server");

  return {
    beginObservedRequest: mocks.beginObservedRequest,
    buildObservedErrorResponse: (message: string, status: number) =>
      NextResponse.json({ error: message }, { status }),
    buildRateLimitedResponse: (decision: { errorCode: string }) =>
      NextResponse.json({ error: decision.errorCode }, { status: 429 }),
    enforceRateLimitPolicy: mocks.enforceRateLimitPolicy,
    finalizeObservedRequest: mocks.finalizeObservedRequest,
    runOperationsMaintenance: mocks.runOperationsMaintenance,
  };
});

import { POST } from "@/app/api/company-knowledge/search/route";

describe("POST /api/company-knowledge/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.enforceRateLimitPolicy.mockResolvedValue(null);
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(createJsonRequest("http://localhost/api/company-knowledge/search", {
      query: "contractors",
    }));

    expect(response.status).toBe(401);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "Authentication required.",
    });
  });

  it("returns 429 when rate limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await POST(createJsonRequest("http://localhost/api/company-knowledge/search", {
      query: "contractors",
    }));

    expect(response.status).toBe(429);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "rate_limited",
    });
  });

  it("returns 400 for an empty query", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/company-knowledge/search", {
      query: "   ",
    }));

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "Search query must be a non-empty string.",
    });
  });

  it("returns owner search results with an automatic-selection summary", async () => {
    const user = createSessionUser({ role: "owner" });
    const result = createSearchResult("owner");
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.searchCompanyKnowledge.mockResolvedValue(result);

    const response = await POST(createJsonRequest("http://localhost/api/company-knowledge/search", {
      query: "contractors 2026",
    }));
    const body = await readJson<typeof result & { role: string; summary: string }>(response);

    expect(response.status).toBe(200);
    expect(body.role).toBe("owner");
    expect(body.selectedFiles).toEqual(["admin/contractors_2026.csv"]);
    expect(body.summary).toContain("Automatically selected admin/contractors_2026.csv");
    expect(body.summary).toContain("Role: Owner.");
    expect(body.summary).toContain("lightweight file manifest");
    expect(body.summary).toContain("Selected CSV columns: ledger_year, contractor, payout.");
    expect(body.summary).toContain("Use the selected file path in inputFiles for run_marimo_analysis");
    expect(body.summary).not.toContain("[admin/contractors_2026.csv:1]");
  });

  it("returns member-scoped results without admin files", async () => {
    const user = createSessionUser({ role: "member" });
    const result = createSearchResult("member");
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.searchCompanyKnowledge.mockResolvedValue(result);

    const response = await POST(createJsonRequest("http://localhost/api/company-knowledge/search", {
      query: "holiday",
    }));
    const body = await readJson<typeof result & { role: string; summary: string }>(response);

    expect(response.status).toBe(200);
    expect(body.role).toBe("member");
    expect(body.selectedFiles).toEqual(["public/holidays.txt"]);
    expect(body.summary).not.toContain("admin/");
  });
});
