import { describe, expect, it } from "vitest";

import {
  buildGeneratedAssetSummary,
  buildSandboxSummary,
  parseInputFiles,
  parseSandboxRequest,
} from "@/lib/sandbox-route";

describe("sandbox-route helpers", () => {
  it("parses sandbox requests with trimmed code and metadata", () => {
    expect(
      parseSandboxRequest({
        code: "  print('ok')  ",
        inputFiles: [" admin/contractors_2026.csv "],
        runtimeToolCallId: " call-1 ",
        turnId: " turn-1 ",
      }),
    ).toEqual({
      code: "print('ok')",
      inputFiles: ["admin/contractors_2026.csv"],
      runtimeToolCallId: "call-1",
      turnId: "turn-1",
    });
  });

  it("rejects non-string input files", () => {
    expect(parseInputFiles(["ok.csv", 42])).toEqual({
      error: "Every inputFiles entry must be a non-empty string.",
    });
  });

  it("builds stdout-first sandbox summaries", () => {
    expect(buildSandboxSummary("answer", "")).toBe(
      "Sandbox execution completed successfully.\nanswer",
    );
    expect(buildSandboxSummary("", "warning")).toBe(
      "Sandbox execution completed successfully with stderr output.\nwarning",
    );
  });

  it("truncates very long sandbox summaries", () => {
    const longText = "x".repeat(13000);

    expect(buildSandboxSummary(longText, "")).toContain("… [truncated]");
  });

  it("builds generated asset summaries", () => {
    expect(buildGeneratedAssetSummary("Created file.", "document", "outputs/notice.pdf")).toContain(
      "Saved document asset to outputs/notice.pdf.",
    );
  });
});
