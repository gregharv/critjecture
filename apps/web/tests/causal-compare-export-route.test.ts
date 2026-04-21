import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  exportCausalRunComparisonZip: vi.fn(),
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
  exportCausalRunComparisonZip: mocks.exportCausalRunComparisonZip,
}));

import { GET } from "@/app/api/causal/studies/[studyId]/compare-export/route";
import { CausalExportError } from "@/lib/causal-export";

describe("GET /api/causal/studies/[studyId]/compare-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.exportCausalRunComparisonZip.mockResolvedValue({
      archiveFileName: "causal-comparison.zip",
      buffer: Buffer.from("zip-data", "utf8"),
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/causal/studies/study-1/compare-export?baseRunId=run-1&targetRunId=run-2"),
      {
        params: Promise.resolve({ studyId: "study-1" }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when query params are missing", async () => {
    const response = await GET(
      new Request("http://localhost/api/causal/studies/study-1/compare-export"),
      {
        params: Promise.resolve({ studyId: "study-1" }),
      },
    );

    expect(response.status).toBe(400);
  });

  it("returns a zip download for run comparison exports", async () => {
    const response = await GET(
      new Request("http://localhost/api/causal/studies/study-1/compare-export?baseRunId=run-1&targetRunId=run-2"),
      {
        params: Promise.resolve({ studyId: "study-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="causal-comparison.zip"',
    );
    expect(mocks.exportCausalRunComparisonZip).toHaveBeenCalledWith({
      baseRunId: "run-1",
      organizationId: "org-1",
      studyId: "study-1",
      targetRunId: "run-2",
    });
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("zip-data");
  });

  it("returns 404 when one of the causal runs is missing", async () => {
    mocks.exportCausalRunComparisonZip.mockRejectedValue(
      new CausalExportError("Causal run not found.", "causal_run_not_found"),
    );

    const response = await GET(
      new Request("http://localhost/api/causal/studies/study-1/compare-export?baseRunId=missing&targetRunId=run-2"),
      {
        params: Promise.resolve({ studyId: "study-1" }),
      },
    );

    expect(response.status).toBe(404);
  });
});
