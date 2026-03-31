import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HOSTED_PERSISTENCE_ENVELOPE } from "@/lib/persistence-policy";

describe("hosted documentation boundary", () => {
  it("documents hosted as a dedicated customer cell instead of a shared multi-org runtime", async () => {
    const docs = await Promise.all([
      readFile(path.join(process.cwd(), "docs", "deployment.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "hosted_launch.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "hosted_provisioning.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "runbooks", "hosted-first-deployment.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "runbooks", "railway-demo-deployment.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "runbooks", "railway-hosted-deployment.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "runbooks", "hosted-restore-drill.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "runbooks", "hosted-routine-upgrade.md"), "utf8"),
      readFile(path.join(process.cwd(), "docs", "security_review.md"), "utf8"),
    ]);
    const combined = docs.join("\n");

    expect(combined).toContain("one hosted deployment cell contains exactly one customer organization");
    expect(combined).toContain("hosted remains SQLite-backed per dedicated customer cell");
    expect(combined).toContain("one writable web-app instance is supported per hosted cell");
    expect(combined).toContain("production-ready within the documented dedicated-customer-cell envelope");
    expect(combined).toContain("Hosted Launch Package");
    expect(combined).toContain("pnpm release:proof:hosted");
    expect(combined).toContain("customer administrator");
    expect(combined).toContain("one Railway project or equivalent isolated service set per organization");
    expect(combined).toContain("the owner of each organization manages only that organization's users");
    expect(combined).toContain("one `owner` account for the operator only");
    expect(combined).toContain("one or more `admin` accounts for technical evaluators");
    expect(combined).toContain("one or more `member` accounts for general product viewers");
    expect(combined).toContain("The supervisor must be bound to the same organization slug as the Railway web service.");
    expect(combined).toContain("Do not place multiple organizations into one hosted Railway web service or one hosted Railway database.");
    expect(combined).toContain(`target RPO: \`${HOSTED_PERSISTENCE_ENVELOPE.targetRpoHours}\` hours`);
    expect(combined).toContain(`target RTO: \`${HOSTED_PERSISTENCE_ENVELOPE.targetRtoHours}\` hours`);
    expect(combined).not.toContain("one deployment can contain multiple organizations");
    expect(combined).not.toContain("shared operator-managed infrastructure with application-level tenant separation");
    expect(combined).not.toContain("not yet broadly production-ready");
  });
});
