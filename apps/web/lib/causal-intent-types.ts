export const CAUSAL_INTENT_MODEL_NAME = "heuristic-causal-intent-router-v4";
export const CAUSAL_INTENT_PROMPT_VERSION = "causal-intent-flowchart-v4";
export const DESCRIPTIVE_FALLBACK_PATH = "/chat";
export const PREDICTIVE_FALLBACK_PATH = "/predictive";

export const INTENT_TYPES = [
  "descriptive",
  "associational",
  "predictive",
  "diagnostic",
  "causal",
  "counterfactual",
  "unclear",
] as const;

export const ROUTING_DECISIONS = [
  "continue_descriptive",
  "open_predictive_analysis",
  "open_causal_study",
  "ask_clarification",
  "blocked",
] as const;

export const CAUSAL_QUESTION_TYPES = [
  "cause_of_observed_change",
  "intervention_effect",
  "counterfactual",
  "mediation",
  "instrumental_variable",
  "selection_bias",
  "other",
] as const;

export const EPISTEMIC_POSTURES = [
  "exploratory",
  "diagnostic",
  "predictive",
  "causal_risk",
  "data_limited",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];
export type RoutingDecision = (typeof ROUTING_DECISIONS)[number];
export type CausalQuestionType = (typeof CAUSAL_QUESTION_TYPES)[number];
export type EpistemicPosture = (typeof EPISTEMIC_POSTURES)[number];

export type CausalIntentClassification = {
  confidence: number;
  intentType: IntentType;
  isCausal: boolean;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  questionType: CausalQuestionType;
  rawOutputJson: string;
  reason: string;
  routingDecision: RoutingDecision;
};

export type ParsedCausalIntentOutput = {
  confidence: number;
  intent_type: IntentType;
  is_causal: boolean;
  question_type?: CausalQuestionType;
  raw_output_json?: string;
  reason: string;
  routing_decision?: RoutingDecision;
};

export type CausalIntakeRequest = {
  clarificationState?: {
    epistemicPosture?: EpistemicPosture | null;
  } | null;
  message: string;
  studyId?: string | null;
};

export type ContinueDescriptiveIntakeResponse = {
  decision: "continue_descriptive";
  intent: {
    confidence: number;
    intent_type: IntentType;
    is_causal: false;
    reason: string;
  };
  nextPath: string;
};

export type OpenPredictiveAnalysisIntakeResponse = {
  decision: "open_predictive_analysis";
  intent: {
    confidence: number;
    intent_type: "associational" | "predictive";
    is_causal: false;
    reason: string;
  };
  nextPath: string;
};

export type OpenCausalStudyIntakeResponse = {
  decision: "open_causal_study";
  intent: {
    confidence: number;
    intent_type: IntentType;
    is_causal: true;
    reason: string;
  };
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  questionType: CausalQuestionType;
  studyId: string;
  studyQuestionId: string;
  suggestedDatasetIds: string[];
};

export type AskClarificationIntakeResponse = {
  clarificationState: {
    epistemicPosture: EpistemicPosture;
  };
  decision: "ask_clarification";
  intent: {
    confidence: number;
    intent_type: "unclear";
    is_causal: false;
    reason: string;
  };
  question: string;
};

export type BlockedIntakeResponse = {
  decision: "blocked";
  intent: {
    confidence: number;
    intent_type: IntentType;
    is_causal: boolean;
    reason: string;
  };
  message: string;
};

export type CausalIntakeResponse =
  | ContinueDescriptiveIntakeResponse
  | OpenPredictiveAnalysisIntakeResponse
  | OpenCausalStudyIntakeResponse
  | AskClarificationIntakeResponse
  | BlockedIntakeResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIntentType(value: unknown): value is IntentType {
  return typeof value === "string" && INTENT_TYPES.includes(value as IntentType);
}

export function isRoutingDecision(value: unknown): value is RoutingDecision {
  return typeof value === "string" && ROUTING_DECISIONS.includes(value as RoutingDecision);
}

export function isCausalQuestionType(value: unknown): value is CausalQuestionType {
  return typeof value === "string" && CAUSAL_QUESTION_TYPES.includes(value as CausalQuestionType);
}

export function isEpistemicPosture(value: unknown): value is EpistemicPosture {
  return typeof value === "string" && EPISTEMIC_POSTURES.includes(value as EpistemicPosture);
}

export function clampConfidence(value: unknown, fallback = 0.5) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

export function parseCausalIntakeRequest(input: unknown): CausalIntakeRequest | null {
  if (!isRecord(input) || typeof input.message !== "string") {
    return null;
  }

  const message = input.message.trim();

  if (!message) {
    return null;
  }

  const studyId =
    typeof input.studyId === "string" && input.studyId.trim()
      ? input.studyId.trim()
      : null;

  const clarificationState =
    isRecord(input.clarificationState) && isEpistemicPosture(input.clarificationState.epistemicPosture)
      ? {
          epistemicPosture: input.clarificationState.epistemicPosture,
        }
      : null;

  return {
    clarificationState,
    message,
    studyId,
  };
}

export function parseClassifierOutput(input: unknown): ParsedCausalIntentOutput | null {
  const parsed =
    typeof input === "string"
      ? (() => {
          try {
            return JSON.parse(input) as unknown;
          } catch {
            return null;
          }
        })()
      : input;

  if (!isRecord(parsed)) {
    return null;
  }

  if (
    typeof parsed.is_causal !== "boolean" ||
    !isIntentType(parsed.intent_type) ||
    typeof parsed.reason !== "string"
  ) {
    return null;
  }

  const result: ParsedCausalIntentOutput = {
    confidence: clampConfidence(parsed.confidence, 0.5),
    intent_type: parsed.intent_type,
    is_causal: parsed.is_causal,
    reason: parsed.reason.trim(),
  };

  if (isCausalQuestionType(parsed.question_type)) {
    result.question_type = parsed.question_type;
  }

  if (typeof parsed.raw_output_json === "string") {
    result.raw_output_json = parsed.raw_output_json;
  }

  if (isRoutingDecision(parsed.routing_decision)) {
    result.routing_decision = parsed.routing_decision;
  }

  return result;
}
