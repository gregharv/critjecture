import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("hosted documentation boundary", () => {
  it("documents hosted as a dedicated customer cell instead of a shared multi-org runtime", async () => {
    const docs = await Promise.all([
      readFile(path.join(process.cwd(), "docs", "deployment.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "hosted_provisioning.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "security_review.md"), "utf8"),
    ]);
    const combined = docs.join("\n");

    expect(combined).toContain("one hosted deployment cell contains exactly one customer organization");
    expect(combined).not.toContain("one deployment can contain multiple organizations");
    expect(combined).not.toContain("shared operator-managed infrastructure with application-level tenant separation");
  });
});
