import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  cleanupExpiredSandboxArtifacts: vi.fn(),
  getSandboxGeneratedAsset: vi.fn(),
  getSandboxRunByRunId: vi.fn(),
  getSessionUser: vi.fn(),
  normalizeGeneratedAssetRelativePath: vi.fn((value: string) => value),
  readFile: vi.fn(),
  resolveOrganizationStorageRoot: vi.fn(),
  resolvePersistedGeneratedAssetPath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/app-paths", () => ({
  resolveOrganizationStorageRoot: mocks.resolveOrganizationStorageRoot,
}));

vi.mock("@/lib/python-sandbox", async () => {
  const actual = await vi.importActual<typeof import("@/lib/python-sandbox")>("@/lib/python-sandbox");

  return {
    ...actual,
    assertValidSandboxRunId: vi.fn(),
    normalizeGeneratedAssetRelativePath: mocks.normalizeGeneratedAssetRelativePath,
    resolvePersistedGeneratedAssetPath: mocks.resolvePersistedGeneratedAssetPath,
  };
});

vi.mock("@/lib/sandbox-runs", () => ({
  cleanupExpiredSandboxArtifacts: mocks.cleanupExpiredSandboxArtifacts,
  getSandboxGeneratedAsset: mocks.getSandboxGeneratedAsset,
  getSandboxRunByRunId: mocks.getSandboxRunByRunId,
}));

import { GET } from "@/app/api/generated-files/[runId]/[...assetPath]/route";

describe("GET /api/generated-files/[runId]/[...assetPath]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.cleanupExpiredSandboxArtifacts.mockResolvedValue(undefined);
    mocks.getSandboxRunByRunId.mockResolvedValue({
      generatedAssets: [{ relativePath: "outputs/chart.png" }],
      organizationId: "org-1",
      userId: "user-1",
    });
    mocks.getSandboxGeneratedAsset.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      fileName: "chart.png",
      mimeType: "image/png",
      storagePath: "generated-assets/chart.png",
    });
    mocks.resolveOrganizationStorageRoot.mockResolvedValue("/tmp/org-root");
    mocks.resolvePersistedGeneratedAssetPath.mockResolvedValue("/tmp/org-root/generated-assets/chart.png");
    mocks.readFile.mockResolvedValue(Buffer.from("png-bytes"));
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/generated-files/run-1/outputs/chart.png"), {
      params: Promise.resolve({ assetPath: ["outputs", "chart.png"], runId: "run-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 400 when route params are incomplete", async () => {
    const response = await GET(new Request("http://localhost/api/generated-files"), {
      params: Promise.resolve({ assetPath: [], runId: "" }),
    });

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "Generated file path is incomplete.",
    });
  });

  it("returns 404 when the generated asset belongs to another user or organization", async () => {
    mocks.getSandboxRunByRunId.mockResolvedValue({
      generatedAssets: [{ relativePath: "outputs/chart.png" }],
      organizationId: "org-2",
      userId: "user-2",
    });

    const response = await GET(new Request("http://localhost/api/generated-files/run-1/outputs/chart.png"), {
      params: Promise.resolve({ assetPath: ["outputs", "chart.png"], runId: "run-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 when the asset has expired", async () => {
    mocks.getSandboxGeneratedAsset.mockResolvedValue({
      expiresAt: Date.now() - 1,
      fileName: "chart.png",
      mimeType: "image/png",
      storagePath: "generated-assets/chart.png",
    });

    const response = await GET(new Request("http://localhost/api/generated-files/run-1/outputs/chart.png"), {
      params: Promise.resolve({ assetPath: ["outputs", "chart.png"], runId: "run-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("serves owned PNG assets inline", async () => {
    const response = await GET(new Request("http://localhost/api/generated-files/run-1/outputs/chart.png"), {
      params: Promise.resolve({ assetPath: ["outputs", "chart.png"], runId: "run-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe("inline");
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("serves owned PDFs as attachments", async () => {
    mocks.getSandboxRunByRunId.mockResolvedValue({
      generatedAssets: [{ relativePath: "outputs/notice.pdf" }],
      organizationId: "org-1",
      userId: "user-1",
    });
    mocks.getSandboxGeneratedAsset.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      fileName: "notice.pdf",
      mimeType: "application/pdf",
      storagePath: "generated-assets/notice.pdf",
    });
    mocks.resolvePersistedGeneratedAssetPath.mockResolvedValue("/tmp/org-root/generated-assets/notice.pdf");
    mocks.readFile.mockResolvedValue(Buffer.from("%PDF-1.7"));

    const response = await GET(new Request("http://localhost/api/generated-files/run-1/outputs/notice.pdf"), {
      params: Promise.resolve({ assetPath: ["outputs", "notice.pdf"], runId: "run-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="notice.pdf"');
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });
});
