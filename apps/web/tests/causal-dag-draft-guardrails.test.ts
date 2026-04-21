import { describe, expect, it } from "vitest";

import { evaluateDraftDagGuardrails } from "@/lib/causal-dag-draft-guardrails";

describe("evaluateDraftDagGuardrails", () => {
  it("flags duplicate treatment nodes and latent observation errors", () => {
    const result = evaluateDraftDagGuardrails({
      datasetColumnIds: ["column-1", "column-2", "column-3"],
      draft: {
        assumptions: [],
        dataRequirements: [],
        edges: [],
        nodes: [
          {
            datasetColumnId: "column-1",
            label: "Discount rate",
            nodeKey: "discount_rate",
            nodeType: "treatment",
            observedStatus: "observed",
            sourceType: "dataset",
          },
          {
            datasetColumnId: "column-2",
            label: "Campaign",
            nodeKey: "campaign_variant",
            nodeType: "treatment",
            observedStatus: "observed",
            sourceType: "dataset",
          },
          {
            datasetColumnId: "column-3",
            label: "Conversion rate",
            nodeKey: "conversion_rate",
            nodeType: "outcome",
            observedStatus: "observed",
            sourceType: "dataset",
          },
          {
            datasetColumnId: null,
            label: "Hidden demand",
            nodeKey: "hidden_demand",
            nodeType: "latent",
            observedStatus: "observed",
            sourceType: "user",
          },
        ],
        primaryDatasetVersionId: "dataset-version-1",
      },
      requirePinnedPrimaryDataset: true,
    });

    expect(result.errors).toContain("Exactly one treatment node is required in V2.0.");
    expect(result.nodeIssues.discount_rate?.some((issue) => issue.severity === "error")).toBe(true);
    expect(result.nodeIssues.campaign_variant?.some((issue) => issue.severity === "error")).toBe(true);
    expect(result.nodeIssues.hidden_demand?.map((issue) => issue.message)).toContain(
      "Latent node hidden_demand must remain explicitly unobserved.",
    );
  });

  it("warns when no directed path from treatment to outcome is drawn", () => {
    const result = evaluateDraftDagGuardrails({
      datasetColumnIds: ["column-1", "column-2"],
      draft: {
        assumptions: [],
        dataRequirements: [],
        edges: [],
        nodes: [
          {
            datasetColumnId: "column-1",
            label: "Discount rate",
            nodeKey: "discount_rate",
            nodeType: "treatment",
            observedStatus: "observed",
            sourceType: "dataset",
          },
          {
            datasetColumnId: "column-2",
            label: "Conversion rate",
            nodeKey: "conversion_rate",
            nodeType: "outcome",
            observedStatus: "observed",
            sourceType: "dataset",
          },
        ],
        primaryDatasetVersionId: "dataset-version-1",
      },
      requirePinnedPrimaryDataset: true,
    });

    expect(result.warnings).toContain(
      "No directed path from the treatment node to the outcome node is drawn yet.",
    );
    expect(result.nodeIssues.discount_rate?.some((issue) => issue.severity === "warning")).toBe(true);
    expect(result.nodeIssues.conversion_rate?.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("flags cycle participants on both nodes and edges", () => {
    const result = evaluateDraftDagGuardrails({
      datasetColumnIds: ["column-1", "column-2", "column-3"],
      draft: {
        assumptions: [],
        dataRequirements: [],
        edges: [
          {
            edgeKey: "discount_rate->conversion_rate",
            relationshipLabel: "causes",
            sourceNodeKey: "discount_rate",
            targetNodeKey: "conversion_rate",
          },
          {
            edgeKey: "conversion_rate->hidden_demand",
            relationshipLabel: "causes",
            sourceNodeKey: "conversion_rate",
            targetNodeKey: "hidden_demand",
          },
          {
            edgeKey: "hidden_demand->discount_rate",
            relationshipLabel: "causes",
            sourceNodeKey: "hidden_demand",
            targetNodeKey: "discount_rate",
          },
        ],
        nodes: [
          {
            datasetColumnId: "column-1",
            label: "Discount rate",
            nodeKey: "discount_rate",
            nodeType: "treatment",
            observedStatus: "observed",
            sourceType: "dataset",
          },
          {
            datasetColumnId: "column-2",
            label: "Conversion rate",
            nodeKey: "conversion_rate",
            nodeType: "outcome",
            observedStatus: "observed",
            sourceType: "dataset",
          },
          {
            datasetColumnId: null,
            label: "Hidden demand",
            nodeKey: "hidden_demand",
            nodeType: "confounder",
            observedStatus: "unobserved",
            sourceType: "user",
          },
        ],
        primaryDatasetVersionId: "dataset-version-1",
      },
      requirePinnedPrimaryDataset: true,
    });

    expect(result.errors).toContain("The DAG must be acyclic before approval.");
    expect(result.nodeIssues.discount_rate?.map((issue) => issue.message)).toContain(
      "The DAG must be acyclic before approval.",
    );
    expect(result.nodeIssues.conversion_rate?.map((issue) => issue.message)).toContain(
      "The DAG must be acyclic before approval.",
    );
    expect(result.nodeIssues.hidden_demand?.map((issue) => issue.message)).toContain(
      "The DAG must be acyclic before approval.",
    );
    expect(result.edgeIssues["discount_rate->conversion_rate"]?.map((issue) => issue.message)).toContain(
      "The DAG must be acyclic before approval.",
    );
    expect(result.edgeIssues["conversion_rate->hidden_demand"]?.map((issue) => issue.message)).toContain(
      "The DAG must be acyclic before approval.",
    );
    expect(result.edgeIssues["hidden_demand->discount_rate"]?.map((issue) => issue.message)).toContain(
      "The DAG must be acyclic before approval.",
    );
  });
});
