export const ANALYSIS_CLAIM_LABELS = [
  "UNFALSIFIABLE HIGHER-RUNG CONJECTURE",
  "SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA",
  "CORROBORATED HIGHER-RUNG CONJECTURE",
  "WEAKLY CORROBORATED HIGHER-RUNG CONJECTURE",
  "FALSIFIED HIGHER-RUNG CONJECTURE",
] as const;

export type AnalysisClaimLabel = (typeof ANALYSIS_CLAIM_LABELS)[number];

export type AnalysisEpistemicVerdict = {
  claimLabel: AnalysisClaimLabel;
  summaryText: string;
};

export function deriveAnalysisEpistemicVerdict(input: {
  blockingReasons?: string[] | null;
  identified?: boolean | null;
  outcomeNodeKey?: string | null;
  refutationStatuses?: Array<string | null | undefined>;
  treatmentNodeKey?: string | null;
}) : AnalysisEpistemicVerdict {
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
      claimLabel: "UNFALSIFIABLE HIGHER-RUNG CONJECTURE",
      summaryText:
        "A higher-rung test could not be specified because the treatment or outcome is not defined clearly enough for refutation.",
    };
  }

  if (input.identified !== true) {
    const missingStructure = blockingReasons.some((reason) =>
      /treatment or outcome node is missing|missing from the dag/i.test(reason),
    );

    if (missingStructure) {
      return {
        claimLabel: "UNFALSIFIABLE HIGHER-RUNG CONJECTURE",
        summaryText:
          "The conjecture could not be exposed to refutation because the higher-rung setup is not fully specified in the current graph.",
      };
    }

    return {
      claimLabel: "SEVERE TESTING NOT POSSIBLE WITH CURRENT DATA",
      summaryText:
        "The higher-rung conjecture could not be severely tested with the current graph and data, so no defensible higher-rung conclusion is available.",
    };
  }

  if (statuses.includes("failed")) {
    return {
      claimLabel: "FALSIFIED HIGHER-RUNG CONJECTURE",
      summaryText:
        "The higher-rung conjecture failed at least one falsification check, indicating the observed effect is likely driven by confounding, instability, or noise.",
    };
  }

  if (statuses.includes("warning")) {
    return {
      claimLabel: "WEAKLY CORROBORATED HIGHER-RUNG CONJECTURE",
      summaryText:
        "The higher-rung conjecture survived baseline identification but weakened under stricter stress tests, so it remains only weakly corroborated.",
    };
  }

  if (statuses.includes("passed")) {
    return {
      claimLabel: "CORROBORATED HIGHER-RUNG CONJECTURE",
      summaryText:
        `The higher-rung conjecture about ${treatmentNodeKey} and ${outcomeNodeKey} was subjected to stored severe tests and remains unfalsified.`,
    };
  }

  return {
    claimLabel: "WEAKLY CORROBORATED HIGHER-RUNG CONJECTURE",
    summaryText:
      "The higher-rung conjecture is identified, but severe-test evidence is incomplete, so the result should be treated as weakly corroborated.",
  };
}
