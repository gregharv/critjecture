export const ANALYTICAL_COMPAT_EPISTEMIC_POSTURES = [
  "exploratory",
  "diagnostic",
  "predictive",
  "guardrail",
  "data_limited",
] as const;

export const ANALYTICAL_COMPAT_CLARIFICATION_KINDS = [
  "goal_disambiguation",
  "metric_needed",
  "time_window_needed",
  "grouping_needed",
  "data_source_needed",
  "loaded_presupposition_reframe",
  "next_detail",
] as const;

export type AnalyticalClarificationPosture =
  (typeof ANALYTICAL_COMPAT_EPISTEMIC_POSTURES)[number];
export type AnalyticalClarificationKind =
  (typeof ANALYTICAL_COMPAT_CLARIFICATION_KINDS)[number];

export type AnalyticalClarificationIntentType =
  | "descriptive"
  | "associational"
  | "predictive"
  | "diagnostic"
  | "causal"
  | "counterfactual"
  | "unclear";

export type AnalyticalClarificationRoutingDecision =
  | "continue_chat"
  | "open_rung1_analysis"
  | "open_rung2_study"
  | "open_rung3_study"
  | "ask_clarification"
  | "blocked";

export type AnalyticalClarificationClassification = {
  confidence: number;
  intentType: AnalyticalClarificationIntentType;
  isCausal: boolean;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  rawOutputJson: string;
  reason: string;
  routingDecision: AnalyticalClarificationRoutingDecision;
};
