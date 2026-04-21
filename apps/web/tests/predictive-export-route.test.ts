import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  exportPredictiveRunZip: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/predictive-export", () => ({
  PredictiveExportError: class PredictiveExportError extends Error {
    readonly code: string;

    constructor(message: string, code = "predictive_export_error") {
      super(message);
      this.code = code;
      this.name = "PredictiveExportError";
    }
  },
  exportPredictiveRunZip: mocks.exportPredictiveRunZip,
}));

import { GET } from "@/app/api/predictive/runs/[runId]/export/route";
import { PredictiveExportError } from "@/lib/predictive-export";

describe("GET /api/predictive/runs/[runId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.exportPredictiveRunZip.mockResolvedValue({
      archiveFileName: "predictive-run.zip",
      buffer: Buffer.from("zip-data", "utf8"),
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/predictive/runs/run-1/export"), {
      params: Promise.resolve({ runId: "run-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns a zip download for predictive runs", async () => {
    const response = await GET(new Request("http://localhost/api/predictive/runs/run-1/export"), {
      params: Promise.resolve({ runId: "run-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="predictive-run.zip"',
    );
    expect(mocks.exportPredictiveRunZip).toHaveBeenCalledWith({
      organizationId: "org-1",
      runId: "run-1",
    });
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("zip-data");
  });

  it("returns 404 when the predictive run is missing", async () => {
    mocks.exportPredictiveRunZip.mockRejectedValue(new PredictiveExportError("Predictive run not found.", "predictive_run_not_found"));

    const response = await GET(new Request("http://localhost/api/predictive/runs/missing/export"), {
      params: Promise.resolve({ runId: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
