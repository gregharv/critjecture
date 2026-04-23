import { describe, expect, it } from "vitest";

import { classifyAnalysisRequest } from "@/lib/analysis-router";

describe("analysis router", () => {
  it("keeps conceptual Pearl questions in ordinary chat", async () => {
    const classification = await classifyAnalysisRequest("What is Pearl's ladder of causation?");

    expect(classification.analysisMode).toBe("ordinary_chat");
    expect(classification.routingDecision).toBe("continue_chat");
    expect(classification.requiredRung).toBeNull();
  });

  it("routes forecasting to rung 1 observational analysis", async () => {
    const classification = await classifyAnalysisRequest("Forecast next month's sales.");

    expect(classification.analysisMode).toBe("dataset_backed_analysis");
    expect(classification.requiredRung).toBe("rung_1_observational");
    expect(classification.routingDecision).toBe("open_rung1_analysis");
    expect(classification.taskForm).toBe("predict");
  });

  it("routes intervention questions to rung 2", async () => {
    const classification = await classifyAnalysisRequest("What happens if we cut price by 10%?");

    expect(classification.requiredRung).toBe("rung_2_interventional");
    expect(classification.routingDecision).toBe("open_rung2_study");
  });

  it("routes counterfactual questions to rung 3", async () => {
    const classification = await classifyAnalysisRequest(
      "Would churn have been lower if we had not changed onboarding?",
    );

    expect(classification.requiredRung).toBe("rung_3_counterfactual");
    expect(classification.routingDecision).toBe("open_rung3_study");
  });

  it("flags unsupported direct mechanism jumps", async () => {
    const classification = await classifyAnalysisRequest(
      "We observed churn rose after onboarding changed; what mechanism caused it?",
    );

    expect(classification.guardrailFlag).toBe("unsupported_direct_mechanism");
    expect(classification.routingDecision).toBe("ask_clarification");
  });
});
