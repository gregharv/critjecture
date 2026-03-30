import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HOSTED_PERSISTENCE_ENVELOPE } from "@/lib/persistence-policy";

describe("hosted documentation boundary", () => {
  it("documents hosted as a dedicated customer cell instead of a shared multi-org runtime", async () => {
    const docs = await Promise.all([
      readFile(path.join(process.cwd(), "docs", "deployment.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "hosted_provisioning.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "runbooks", "hosted-restore-drill.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "security_review.md"), "utf8"),
    ]);
    const combined = docs.join("\n");

    expect(combined).toContain("one hosted deployment cell contains exactly one customer organization");
    expect(combined).toContain("hosted remains SQLite-backed per dedicated customer cell");
    expect(combined).toContain("one writable web-app instance is supported per hosted cell");
    expect(combined).toContain(`target RPO: \`${HOSTED_PERSISTENCE_ENVELOPE.targetRpoHours}\` hours`);
    expect(combined).toContain(`target RTO: \`${HOSTED_PERSISTENCE_ENVELOPE.targetRtoHours}\` hours`);
    expect(combined).not.toContain("one deployment can contain multiple organizations");
    expect(combined).not.toContain("shared operator-managed infrastructure with application-level tenant separation");
  });
});
