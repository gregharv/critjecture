import { describe, expect, it } from "vitest";

import {
  buildConversationalClarificationQuestion,
  buildEffectiveAnalyticalPrompt,
  looksLikeStandaloneAnalyticalRequest,
} from "@/lib/analytical-clarification";

function expectOneOf(text: string, options: string[]) {
  expect(options.some((option) => text.includes(option))).toBe(true);
}

describe("analytical clarification helpers", () => {
  it("treats terse follow-ups as clarification context to append", () => {
    expect(buildEffectiveAnalyticalPrompt("Help me understand conversion", "last month by region")).toBe(
      "Help me understand conversion\nlast month by region",
    );
  });

  it("uses the last clarification question to interpret terse answers more explicitly", () => {
    expect(
      buildEffectiveAnalyticalPrompt(
        "Help me understand conversion last month",
        "overall first",
        "Do you want the answer at the overall level, or broken out by something like region, segment, or customer type?",
      ),
    ).toBe("Help me understand conversion last month\nI want to start at the overall level first.");
  });

  it("uses the last clarification question to interpret data-availability replies", () => {
    expect(
      buildEffectiveAnalyticalPrompt(
        "Help me understand conversion last month by region",
        "we have a csv already",
        "Do you already have a dataset or file in mind for this, or should we first figure out what data would actually let us answer it?",
      ),
    ).toBe(
      "Help me understand conversion last month by region\nI already have data in mind: we have a csv already.",
    );
  });

  it("replaces pending context when the user starts a new standalone request", () => {
    expect(
      buildEffectiveAnalyticalPrompt(
        "Help me understand conversion",
        "What happened to revenue last month?",
      ),
    ).toBe("What happened to revenue last month?");
  });

  it("does not duplicate context when the latest message already includes it", () => {
    expect(
      buildEffectiveAnalyticalPrompt(
        "Help me understand conversion",
        "Help me understand conversion last month by region",
      ),
    ).toBe("Help me understand conversion last month by region");
  });

  it("recognizes short intent labels as standalone analytical requests", () => {
    expect(looksLikeStandaloneAnalyticalRequest("descriptive summary")).toBe(true);
    expect(looksLikeStandaloneAnalyticalRequest("last month by region")).toBe(false);
  });

  it("builds conversational clarification questions instead of checklist prompts", () => {
    const clarification = buildConversationalClarificationQuestion("Can you help me understand conversion?", {
      confidence: 0.6,
      intentType: "unclear",
      isCausal: false,
      proposedOutcomeLabel: "conversion",
      proposedTreatmentLabel: null,
      questionType: "other",
      rawOutputJson: "{}",
      reason: "test",
      routingDecision: "ask_clarification",
    });

    expect(clarification.epistemicPosture).toBe("data_limited");
    expectOneOf(clarification.question, [
      "Got it — you're looking at conversion.",
      "Understood — you're focused on conversion.",
      "Okay — this seems to be about conversion.",
    ]);
    expectOneOf(clarification.question, [
      "explain a change in conversion",
      "explanation for a change in it",
      "causal answer about what changed it",
    ]);
    expect(clarification.question).not.toContain("To make this analysis useful, can you clarify");
  });

  it("asks only for the next missing detail once the user already supplied context", () => {
    const clarification = buildConversationalClarificationQuestion(
      "Help me understand conversion last month by region",
      {
        confidence: 0.6,
        intentType: "unclear",
        isCausal: false,
        proposedOutcomeLabel: "conversion",
        proposedTreatmentLabel: null,
        questionType: "other",
        rawOutputJson: "{}",
        reason: "test",
        routingDecision: "ask_clarification",
      },
    );

    expect(clarification.epistemicPosture).toBe("data_limited");
    expectOneOf(clarification.question, [
      "Got it — you're looking at conversion last month by region.",
      "Understood — you're focused on conversion last month by region.",
      "Okay — this seems to be about conversion last month by region.",
    ]);
    expectOneOf(clarification.question, [
      "explain why conversion changed",
      "explain why conversion moved",
      "get into why conversion changed",
    ]);
    expectOneOf(clarification.question, [
      "what changed by region",
      "map what changed by region",
      "how it shifted by region",
    ]);
    expect(clarification.question).not.toContain("time window");
    expect(clarification.question).not.toContain("grouping");
  });

  it("challenges loaded mechanism questions with a reframing clarification", () => {
    const clarification = buildConversationalClarificationQuestion(
      "We found a statistically significant correlation between pressure and load. What mechanism explains it? Assuming the telemetry is accurate, what physical pathway forces the outcome?",
      {
        confidence: 0.6,
        intentType: "unclear",
        isCausal: false,
        proposedOutcomeLabel: null,
        proposedTreatmentLabel: null,
        questionType: "other",
        rawOutputJson: "{}",
        reason: "test",
        routingDecision: "ask_clarification",
      },
    );

    expect(clarification.epistemicPosture).toBe("causal_risk");
    expectOneOf(clarification.question, [
      "shared driver or confounding pattern",
      "challenge the direct-causation framing",
      "omitted context or a common driver",
    ]);
  });

  it("adds a data-feasibility nudge when the user is still figuring out what the data can support", () => {
    const clarification = buildConversationalClarificationQuestion("What can we answer with this data?", {
      confidence: 0.6,
      intentType: "unclear",
      isCausal: false,
      proposedOutcomeLabel: null,
      proposedTreatmentLabel: null,
      questionType: "other",
      rawOutputJson: "{}",
      reason: "test",
      routingDecision: "ask_clarification",
    });

    expect(clarification.epistemicPosture).toBe("data_limited");
    expectOneOf(clarification.question, [
      "what the data can actually support",
      "what question the available data can really answer",
      "the question and the likely data fit each other",
    ]);
  });

  it("varies the wording of similar clarification prompts across different messages", () => {
    const first = buildConversationalClarificationQuestion("Can you help me understand conversion?", {
      confidence: 0.6,
      intentType: "unclear",
      isCausal: false,
      proposedOutcomeLabel: "conversion",
      proposedTreatmentLabel: null,
      questionType: "other",
      rawOutputJson: "{}",
      reason: "test",
      routingDecision: "ask_clarification",
    });
    const second = buildConversationalClarificationQuestion("Can you help me understand revenue?", {
      confidence: 0.6,
      intentType: "unclear",
      isCausal: false,
      proposedOutcomeLabel: "revenue",
      proposedTreatmentLabel: null,
      questionType: "other",
      rawOutputJson: "{}",
      reason: "test",
      routingDecision: "ask_clarification",
    });

    expect(first.question).not.toBe(second.question);
    expect(first.question).not.toContain("To make this analysis useful, can you clarify");
    expect(second.question).not.toContain("To make this analysis useful, can you clarify");
  });

  it("keeps a non-exploratory posture across follow-up clarifications when the new turn is still ambiguous", () => {
    const clarification = buildConversationalClarificationQuestion(
      "Can you help me understand conversion last month by region?",
      {
        confidence: 0.6,
        intentType: "unclear",
        isCausal: false,
        proposedOutcomeLabel: "conversion",
        proposedTreatmentLabel: null,
        questionType: "other",
        rawOutputJson: "{}",
        reason: "test",
        routingDecision: "ask_clarification",
      },
      "causal_risk",
    );

    expect(clarification.epistemicPosture).toBe("causal_risk");
    expectOneOf(clarification.question, [
      "Before we jump from a pattern to a causal story",
      "I don't want to overread an observed pattern as a causal explanation too quickly.",
      "Before we treat an observed pattern as a mechanism",
    ]);
  });
});
