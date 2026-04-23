export const OBSERVATIONAL_USER_CLAIM_LABEL = "INSTRUMENTAL / HEURISTIC PREDICTION" as const;

export type ObservationalUserClaimLabel = typeof OBSERVATIONAL_USER_CLAIM_LABEL;
export type ObservationalStoredClaimLabel = "associational" | "predictive";

export function toObservationalUserClaimLabel(
  _value: ObservationalStoredClaimLabel | "ASSOCIATIONAL" | "PREDICTIVE" | null | undefined,
): ObservationalUserClaimLabel | null {
  if (!_value) {
    return null;
  }

  return OBSERVATIONAL_USER_CLAIM_LABEL;
}

export function toObservationalStoredClaimLabel(
  value: "ASSOCIATIONAL" | "PREDICTIVE",
): ObservationalStoredClaimLabel {
  return value === "ASSOCIATIONAL" ? "associational" : "predictive";
}

export function buildObservationalClaimSummary(input: {
  forecastSummary?: string;
  metricSummary?: string;
  modelName?: string | null;
}) {
  return `${OBSERVATIONAL_USER_CLAIM_LABEL} result from ${input.modelName ?? "CatBoost"}${input.metricSummary ? ` with ${input.metricSummary}` : ""}${input.forecastSummary ?? ""}. This output describes associational patterns or predictive performance, not causal effects.`;
}
