export const CAUSAL_CLAIM_LABELS = [
  "UNFALSIFIABLE CONJECTURE",
  "SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA",
  "CORROBORATED CAUSAL CONJECTURE",
  "WEAKLY CORROBORATED",
  "FALSIFIED CAUSAL CONJECTURE",
] as const;

export type CausalClaimLabel = (typeof CAUSAL_CLAIM_LABELS)[number];

export type CausalEpistemicVerdict = {
  claimLabel: CausalClaimLabel;
  summaryText: string;
};

export function deriveCausalEpistemicVerdict(input: {
  blockingReasons?: string[] | null;
  identified?: boolean | null;
  outcomeNodeKey?: string | null;
  refutationStatuses?: Array<string | null | undefined>;
  treatmentNodeKey?: string | null;
}) : CausalEpistemicVerdict {
  const blockingReasons = (input.blockingReasons ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const treatmentNodeKey = input.treatmentNodeKey?.trim() ?? "";
  const outcomeNodeKey = input.outcomeNodeKey?.trim() ?? "";
  const statuses = (input.refutationStatuses ?? [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());

  if (!treatmentNodeKey || !outcomeNodeKey) {
    return {
      claimLabel: "UNFALSIFIABLE CONJECTURE",
      summaryText:
        "A causal test could not be specified because the treatment or outcome is not defined clearly enough for refutation.",
    };
  }

  if (input.identified !== true) {
    const missingStructure = blockingReasons.some((reason) =>
      /treatment or outcome node is missing|missing from the dag/i.test(reason),
    );

    if (missingStructure) {
      return {
        claimLabel: "UNFALSIFIABLE CONJECTURE",
        summaryText:
          "The conjecture could not be exposed to refutation because the causal setup is not fully specified in the current graph.",
      };
    }

    return {
      claimLabel: "SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA",
      summaryText:
        "The causal conjecture could not be severely tested with the current graph and data, so no defensible causal conclusion is available.",
    };
  }

  if (statuses.includes("failed")) {
    return {
      claimLabel: "FALSIFIED CAUSAL CONJECTURE",
      summaryText:
        "The causal conjecture failed at least one falsification check, indicating the observed effect is likely driven by confounding, instability, or noise.",
    };
  }

  if (statuses.includes("warning")) {
    return {
      claimLabel: "WEAKLY CORROBORATED",
      summaryText:
        "The causal conjecture survived baseline identification but weakened under stricter stress tests, so it remains only weakly corroborated.",
    };
  }

  if (statuses.includes("passed")) {
    return {
      claimLabel: "CORROBORATED CAUSAL CONJECTURE",
      summaryText:
        `The conjecture that ${treatmentNodeKey} causes ${outcomeNodeKey} was subjected to stored severe tests and remains unfalsified.`,
    };
  }

  return {
    claimLabel: "WEAKLY CORROBORATED",
    summaryText:
      "The causal conjecture is identified, but severe-test evidence is incomplete, so the result should be treated as weakly corroborated.",
  };
}
