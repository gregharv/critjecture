import { describe, expect, it } from "vitest";

import { analyzeDraftDagPaths } from "@/lib/causal-dag-path-assistance";

describe("analyzeDraftDagPaths", () => {
  it("highlights the shortest directed treatment-to-outcome path", () => {
    const result = analyzeDraftDagPaths({
      edges: [
        {
          edgeKey: "discount_rate->signup_intent",
          sourceNodeKey: "discount_rate",
          targetNodeKey: "signup_intent",
        },
        {
          edgeKey: "signup_intent->conversion_rate",
          sourceNodeKey: "signup_intent",
          targetNodeKey: "conversion_rate",
        },
        {
          edgeKey: "discount_rate->conversion_rate",
          sourceNodeKey: "discount_rate",
          targetNodeKey: "conversion_rate",
        },
      ],
      nodes: [
        { nodeKey: "discount_rate", nodeType: "treatment" },
        { nodeKey: "signup_intent", nodeType: "mediator" },
        { nodeKey: "conversion_rate", nodeType: "outcome" },
      ],
    });

    expect(result.pathExists).toBe(true);
    expect(result.pathNodeKeys).toEqual(["discount_rate", "conversion_rate"]);
    expect(result.pathEdgeKeys).toEqual(["discount_rate->conversion_rate"]);
    expect(result.disconnectedNodeKeys).toEqual([]);
  });

  it("surfaces disconnected subgraphs and missing bridge suggestions", () => {
    const result = analyzeDraftDagPaths({
      edges: [
        {
          edgeKey: "discount_rate->signup_intent",
          sourceNodeKey: "discount_rate",
          targetNodeKey: "signup_intent",
        },
        {
          edgeKey: "brand_awareness->conversion_rate",
          sourceNodeKey: "brand_awareness",
          targetNodeKey: "conversion_rate",
        },
        {
          edgeKey: "weather->seasonality",
          sourceNodeKey: "weather",
          targetNodeKey: "seasonality",
        },
      ],
      nodes: [
        { nodeKey: "discount_rate", nodeType: "treatment" },
        { nodeKey: "signup_intent", nodeType: "mediator" },
        { nodeKey: "brand_awareness", nodeType: "confounder" },
        { nodeKey: "conversion_rate", nodeType: "outcome" },
        { nodeKey: "weather", nodeType: "confounder" },
        { nodeKey: "seasonality", nodeType: "mediator" },
      ],
    });

    expect(result.pathExists).toBe(false);
    expect(result.reachableFromTreatmentNodeKeys).toEqual(["discount_rate", "signup_intent"]);
    expect(result.canReachOutcomeNodeKeys).toEqual(["brand_awareness", "conversion_rate"]);
    expect(result.disconnectedNodeKeys).toEqual(["seasonality", "weather"]);
    expect(result.suggestions.some((suggestion) => suggestion.message.includes("discount_rate → conversion_rate"))).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.message.includes("signup_intent → conversion_rate"))).toBe(true);
  });
});
