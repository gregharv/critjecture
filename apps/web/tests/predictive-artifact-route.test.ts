import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonRequest, createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  getPredictiveArtifactDetail: vi.fn(),
  getSessionUser: vi.fn(),
  readFile: vi.fn(),
  resolveOrganizationStorageRoot: vi.fn(),
  resolvePersistedGeneratedAssetPath: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/predictive-analysis", () => ({
  getPredictiveArtifactDetail: mocks.getPredictiveArtifactDetail,
}));

vi.mock("@/lib/app-paths", () => ({
  resolveOrganizationStorageRoot: mocks.resolveOrganizationStorageRoot,
}));

vi.mock("@/lib/python-sandbox", () => ({
  resolvePersistedGeneratedAssetPath: mocks.resolvePersistedGeneratedAssetPath,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

import { GET } from "@/app/api/predictive/runs/[runId]/artifacts/[artifactId]/route";

describe("GET /api/predictive/runs/[runId]/artifacts/[artifactId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.getPredictiveArtifactDetail.mockResolvedValue({
      fileName: "predictive_result.json",
      mimeType: "application/json",
      storagePath: "/tmp/org/predictive_runs/run-1/predictive_result.json",
    });
    mocks.resolveOrganizationStorageRoot.mockResolvedValue("/tmp/org");
    mocks.resolvePersistedGeneratedAssetPath.mockResolvedValue("/tmp/org/predictive_runs/run-1/predictive_result.json");
    mocks.readFile.mockResolvedValue(Buffer.from('{"ok":true}', "utf8"));
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/run-1/artifacts/artifact-1", undefined, { method: "GET" }), {
      params: Promise.resolve({ artifactId: "artifact-1", runId: "run-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("downloads predictive artifacts", async () => {
    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/run-1/artifacts/artifact-1", undefined, { method: "GET" }), {
      params: Promise.resolve({ artifactId: "artifact-1", runId: "run-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toContain("predictive_result.json");
    expect(mocks.getPredictiveArtifactDetail).toHaveBeenCalledWith({
      artifactId: "artifact-1",
      organizationId: "org-1",
      runId: "run-1",
    });
  });

  it("returns 404 when artifact lookup fails", async () => {
    mocks.getPredictiveArtifactDetail.mockRejectedValue(new Error("Predictive artifact not found."));

    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/run-1/artifacts/artifact-1", undefined, { method: "GET" }), {
      params: Promise.resolve({ artifactId: "artifact-1", runId: "run-1" }),
    });

    expect(response.status).toBe(404);
  });
});
