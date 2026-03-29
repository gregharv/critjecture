import { describe, expect, it } from "vitest";

import { isRecentCompletedExport } from "@/lib/governance";

describe("isRecentCompletedExport", () => {
  it("accepts exports completed within the last 24 hours", () => {
    const now = Date.now();
    expect(isRecentCompletedExport(now - 60_000, now)).toBe(true);
  });

  it("rejects stale or missing exports", () => {
    const now = Date.now();
    expect(isRecentCompletedExport(now - 25 * 60 * 60 * 1000, now)).toBe(false);
    expect(isRecentCompletedExport(null, now)).toBe(false);
  });
});
