export const ANALYSIS_QUESTION_TYPES = [
  "cause_of_observed_change",
  "intervention_effect",
  "counterfactual",
  "mediation",
  "instrumental_variable",
  "selection_bias",
  "other",
] as const;

export type AnalysisQuestionType = (typeof ANALYSIS_QUESTION_TYPES)[number];
