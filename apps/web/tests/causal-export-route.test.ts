import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  exportCausalRunZip: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/causal-export", () => ({
  CausalExportError: class CausalExportError extends Error {
    readonly code: string;

    constructor(message: string, code = "causal_export_error") {
      super(message);
      this.code = code;
      this.name = "CausalExportError";
    }
  },
  exportCausalRunZip: mocks.exportCausalRunZip,
}));

import { GET } from "@/app/api/causal/runs/[runId]/export/route";
import { CausalExportError } from "@/lib/causal-export";

describe("GET /api/causal/runs/[runId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.exportCausalRunZip.mockResolvedValue({
      archiveFileName: "causal-run.zip",
      buffer: Buffer.from("zip-data", "utf8"),
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/causal/runs/run-1/export"), {
      params: Promise.resolve({ runId: "run-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns a zip download for causal runs", async () => {
    const response = await GET(new Request("http://localhost/api/causal/runs/run-1/export"), {
      params: Promise.resolve({ runId: "run-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="causal-run.zip"');
    expect(mocks.exportCausalRunZip).toHaveBeenCalledWith({
      organizationId: "org-1",
      runId: "run-1",
    });
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("zip-data");
  });

  it("returns 404 when the causal run is missing", async () => {
    mocks.exportCausalRunZip.mockRejectedValue(new CausalExportError("Causal run not found.", "causal_run_not_found"));

    const response = await GET(new Request("http://localhost/api/causal/runs/missing/export"), {
      params: Promise.resolve({ runId: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
