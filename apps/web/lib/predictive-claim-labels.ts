export const PREDICTIVE_USER_CLAIM_LABEL = "INSTRUMENTAL / HEURISTIC PREDICTION" as const;

export type PredictiveUserClaimLabel = typeof PREDICTIVE_USER_CLAIM_LABEL;
export type PredictiveStoredClaimLabel = "associational" | "predictive";

export function toPredictiveUserClaimLabel(
  _value: PredictiveStoredClaimLabel | "ASSOCIATIONAL" | "PREDICTIVE" | null | undefined,
): PredictiveUserClaimLabel | null {
  if (!_value) {
    return null;
  }

  return PREDICTIVE_USER_CLAIM_LABEL;
}

export function toPredictiveStoredClaimLabel(
  value: "ASSOCIATIONAL" | "PREDICTIVE",
): PredictiveStoredClaimLabel {
  return value === "ASSOCIATIONAL" ? "associational" : "predictive";
}

export function buildPredictiveClaimSummary(input: {
  forecastSummary?: string;
  metricSummary?: string;
  modelName?: string | null;
}) {
  return `${PREDICTIVE_USER_CLAIM_LABEL} result from ${input.modelName ?? "CatBoost"}${input.metricSummary ? ` with ${input.metricSummary}` : ""}${input.forecastSummary ?? ""}. This output describes associational patterns or predictive performance, not causal effects.`;
}
