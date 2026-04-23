import type { AnalysisRoutingClassification } from "@/lib/analysis-routing-types";
import type { AnalysisQuestionType } from "@/lib/analysis-intent-types";

export function toCompatibilityAnalysisQuestionType(
  classification: AnalysisRoutingClassification,
): AnalysisQuestionType {
  if (classification.requiredRung === "rung_3_counterfactual") {
    return "counterfactual";
  }

  if (classification.requiredRung === "rung_2_interventional") {
    return "intervention_effect";
  }

  return "other";
}
