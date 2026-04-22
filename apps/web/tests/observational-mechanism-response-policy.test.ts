import { describe, expect, it } from "vitest";

import {
  buildObservationalMechanismPolicyInstruction,
  classifyObservationalMechanismClarificationReply,
  classifyObservationalMechanismRequest,
  isLoadedMechanismReframeQuestion,
} from "@/lib/observational-mechanism-response-policy";

describe("observational mechanism response policy", () => {
  it("detects loaded mechanism-from-observation requests", () => {
    expect(
      classifyObservationalMechanismRequest(
        "We found a statistically significant negative correlation between pressure and load. Assuming the telemetry is accurate, what physical pathway forces lower pressure to cause higher load?",
      ).kind,
    ).toBe("loaded_mechanism_from_observation");
  });

  it("does not trigger when causal identification cues are present", () => {
    expect(
      classifyObservationalMechanismRequest(
        "In our natural experiment, what mechanism explains the identified causal effect of policy A on churn?",
      ).kind,
    ).toBe("none");
  });

  it("recognizes the clarification question used for direct-framing challenge", () => {
    expect(
      isLoadedMechanismReframeQuestion(
        "Before we assume a direct pathway, do you want to first check whether the pattern could reflect omitted context or a common driver, or are you asking only for possible mechanisms?",
      ),
    ).toBe(true);
  });

  it("maps terse follow-ups to concise observational mode", () => {
    expect(
      classifyObservationalMechanismClarificationReply({
        lastQuestion:
          "Before we assume a direct pathway, do you want to first check whether the pattern could reflect omitted context or a common driver, or are you asking only for possible mechanisms?",
        latestMessage: "just look at the correlation",
      }),
    ).toBe("concise_observational_conclusion");
  });

  it("maps explicit brainstorming requests to hypothesis mode", () => {
    expect(
      classifyObservationalMechanismClarificationReply({
        lastQuestion:
          "Before we assume a direct pathway, do you want to first check whether the pattern could reflect omitted context or a common driver, or are you asking only for possible mechanisms?",
        latestMessage: "brainstorm plausible mechanisms anyway",
      }),
    ).toBe("hypothesis_brainstorm");
  });

  it("builds a concise policy instruction without domain-specific examples", () => {
    const instruction = buildObservationalMechanismPolicyInstruction(
      "concise_observational_conclusion",
    );

    expect(instruction).toContain("observational pattern alone does not establish a direct mechanism");
    expect(instruction).toContain("shared-driver");
    expect(instruction).not.toContain("water");
    expect(instruction).not.toContain("electrical");
  });
});
