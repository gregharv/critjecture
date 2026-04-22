import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  clearRecentComparisons: vi.fn(),
  deleteComparisonSnapshot: vi.fn(),
  deleteRecentComparison: vi.fn(),
  getSessionUser: vi.fn(),
  recordRecentComparison: vi.fn(),
  renameComparisonSnapshot: vi.fn(),
  saveComparisonSnapshot: vi.fn(),
  togglePinComparisonSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/causal-comparisons", () => ({
  clearRecentComparisons: mocks.clearRecentComparisons,
  deleteComparisonSnapshot: mocks.deleteComparisonSnapshot,
  deleteRecentComparison: mocks.deleteRecentComparison,
  recordRecentComparison: mocks.recordRecentComparison,
  renameComparisonSnapshot: mocks.renameComparisonSnapshot,
  saveComparisonSnapshot: mocks.saveComparisonSnapshot,
  togglePinComparisonSnapshot: mocks.togglePinComparisonSnapshot,
}));

import { POST } from "@/app/api/causal/studies/[studyId]/comparison-state/route";

describe("POST /api/causal/studies/[studyId]/comparison-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.saveComparisonSnapshot.mockResolvedValue({ recentComparisons: [], snapshots: [] });
    mocks.renameComparisonSnapshot.mockResolvedValue({ recentComparisons: [], snapshots: [] });
    mocks.togglePinComparisonSnapshot.mockResolvedValue({ recentComparisons: [], snapshots: [] });
    mocks.deleteComparisonSnapshot.mockResolvedValue({ recentComparisons: [], snapshots: [] });
    mocks.recordRecentComparison.mockResolvedValue({ recentComparisons: [], snapshots: [] });
    mocks.deleteRecentComparison.mockResolvedValue({ recentComparisons: [], snapshots: [] });
    mocks.clearRecentComparisons.mockResolvedValue({ recentComparisons: [], snapshots: [] });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({ action: "clear_recent" }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: "{",
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for unsupported actions", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({ action: "unknown" }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("saves a comparison snapshot", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({
          action: "save_snapshot",
          baseRunId: "run-1",
          name: "Best vs latest",
          targetRunId: "run-2",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.saveComparisonSnapshot).toHaveBeenCalledWith({
      baseRunId: "run-1",
      name: "Best vs latest",
      organizationId: "org-1",
      studyId: "study-1",
      targetRunId: "run-2",
      userId: "user-1",
    });
  });

  it("renames a comparison snapshot", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({
          action: "rename_snapshot",
          name: "Pinned baseline",
          snapshotId: "snapshot-1",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.renameComparisonSnapshot).toHaveBeenCalledWith({
      name: "Pinned baseline",
      organizationId: "org-1",
      snapshotId: "snapshot-1",
      studyId: "study-1",
      userId: "user-1",
    });
  });

  it("toggles snapshot pin state", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({
          action: "toggle_pin_snapshot",
          snapshotId: "snapshot-1",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.togglePinComparisonSnapshot).toHaveBeenCalledWith({
      organizationId: "org-1",
      snapshotId: "snapshot-1",
      studyId: "study-1",
      userId: "user-1",
    });
  });

  it("deletes a comparison snapshot", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({
          action: "delete_snapshot",
          snapshotId: "snapshot-1",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteComparisonSnapshot).toHaveBeenCalledWith({
      organizationId: "org-1",
      snapshotId: "snapshot-1",
      studyId: "study-1",
      userId: "user-1",
    });
  });

  it("tracks a recent comparison", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({
          action: "track_recent",
          baseRunId: "run-1",
          targetRunId: "run-2",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.recordRecentComparison).toHaveBeenCalledWith({
      baseRunId: "run-1",
      organizationId: "org-1",
      studyId: "study-1",
      targetRunId: "run-2",
      userId: "user-1",
    });
  });

  it("deletes a recent comparison", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({
          action: "delete_recent",
          recentComparisonId: "recent-1",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteRecentComparison).toHaveBeenCalledWith({
      organizationId: "org-1",
      recentComparisonId: "recent-1",
      studyId: "study-1",
      userId: "user-1",
    });
  });

  it("clears recent comparisons", async () => {
    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({ action: "clear_recent" }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.clearRecentComparisons).toHaveBeenCalledWith({
      organizationId: "org-1",
      studyId: "study-1",
      userId: "user-1",
    });
  });

  it("maps not-found errors to 404", async () => {
    mocks.renameComparisonSnapshot.mockRejectedValue(new Error("Comparison snapshot not found."));

    const response = await POST(
      new Request("http://localhost/api/causal/studies/study-1/comparison-state", {
        body: JSON.stringify({
          action: "rename_snapshot",
          name: "Pinned baseline",
          snapshotId: "snapshot-1",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(404);
  });
});
