import { describe, expect, it } from "vitest";

import {
  extractMentionedFilePaths,
  getFileMentionMatch,
  replaceFileMention,
} from "@/lib/chat-file-mentions";

describe("chat file mentions", () => {
  it("detects an active @mention query at the cursor", () => {
    expect(getFileMentionMatch("Compare @admin/rev", "Compare @admin/rev".length)).toEqual({
      query: "admin/rev",
      replaceFrom: 8,
      replaceTo: 18,
    });
  });

  it("replaces the active token with a normalized source path", () => {
    const input = "Compare @admin/rev with last year";
    const match = getFileMentionMatch(input, "Compare @admin/rev".length);

    expect(match).not.toBeNull();
    expect(
      replaceFileMention(input, match!, "admin/revenue_2026.csv"),
    ).toBe("Compare @admin/revenue_2026.csv with last year");
  });

  it("extracts distinct mentioned file paths from message text", () => {
    expect(
      extractMentionedFilePaths(
        "Compare @admin/revenue_2025.csv and @admin/revenue_2026.csv, then recheck @admin/revenue_2025.csv.",
      ),
    ).toEqual(["admin/revenue_2025.csv", "admin/revenue_2026.csv"]);
  });

  it("ignores plain email addresses and incomplete tokens", () => {
    expect(
      extractMentionedFilePaths(
        "Email finance@example.com or mention @finance but not @admin/revenue",
      ),
    ).toEqual([]);
  });
});
