import { describe, expect, it } from "vitest";

import type { AgentMessage } from "@mariozechner/pi-web-ui";

import { upsertObservationalPlanningMessage } from "@/lib/observational-planning-messages";

describe("observational planning messages", () => {
  it("appends an observational planning panel when none exists", () => {
    const messages = upsertObservationalPlanningMessage([] as AgentMessage[], {
      objective: "Reduce churn in the mid-market segment.",
      targetColumn: "churn_risk",
      candidateDrivers: ["usage decline", "support tickets"],
      readyForObservationalWorkspace: false,
      successMetric: "Rank the highest-risk accounts early enough for outreach.",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "observational-planning",
      candidateDrivers: ["usage decline", "support tickets"],
      objective: "Reduce churn in the mid-market segment.",
      readyForObservationalWorkspace: false,
      successMetric: "Rank the highest-risk accounts early enough for outreach.",
      targetColumn: "churn_risk",
    });
  });
});
