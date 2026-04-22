import { describe, expect, it } from "vitest";

import type { AgentMessage } from "@mariozechner/pi-web-ui";

import { upsertPredictivePlanningMessage } from "@/lib/predictive-planning-messages";

describe("predictive planning messages", () => {
  it("appends a predictive planning panel when none exists", () => {
    const messages = upsertPredictivePlanningMessage([] as AgentMessage[], {
      objective: "Reduce churn in the mid-market segment.",
      targetColumn: "churn_risk",
      candidateDrivers: ["usage decline", "support tickets"],
      readyForPredictiveWorkspace: false,
      successMetric: "Rank the highest-risk accounts early enough for outreach.",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "predictive-planning",
      candidateDrivers: ["usage decline", "support tickets"],
      objective: "Reduce churn in the mid-market segment.",
      readyForPredictiveWorkspace: false,
      successMetric: "Rank the highest-risk accounts early enough for outreach.",
      targetColumn: "churn_risk",
    });
  });

  it("updates the latest predictive planning panel in place", () => {
    const firstPass = upsertPredictivePlanningMessage([] as AgentMessage[], {
      objective: "Forecast bookings.",
      targetColumn: "bookings",
      readyForPredictiveWorkspace: false,
    });

    const secondPass = upsertPredictivePlanningMessage(firstPass, {
      candidateDrivers: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      nextQuestion: "Which success metric matters most: MAPE or directional accuracy?",
      readyForPredictiveWorkspace: false,
      successMetric: "Directional accuracy for the executive review.",
    });

    expect(secondPass).toHaveLength(1);
    expect(secondPass[0]).toMatchObject({
      role: "predictive-planning",
      candidateDrivers: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      nextQuestion: "Which success metric matters most: MAPE or directional accuracy?",
      objective: "Forecast bookings.",
      readyForPredictiveWorkspace: false,
      successMetric: "Directional accuracy for the executive review.",
      targetColumn: "bookings",
    });
  });
});
