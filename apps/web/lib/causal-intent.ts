import {
  CAUSAL_INTENT_MODEL_NAME,
  CAUSAL_INTENT_PROMPT_VERSION,
  type CausalIntentClassification,
  type CausalQuestionType,
  DESCRIPTIVE_FALLBACK_PATH,
  PREDICTIVE_FALLBACK_PATH,
  parseClassifierOutput,
} from "@/lib/causal-intent-types";

function normalizeMessage(message: string) {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const COUNTERFACTUAL_PATTERNS = [
  /\bcounterfactual\b/i,
  /\bwhat happens if\b/i,
  /\bwhat would happen if\b/i,
  /\bwhat will happen if\b/i,
  /\bwould .* happen if\b/i,
  /\bif we (increase|decrease|change|raise|lower|reduce|remove|add)\b/i,
];

const EXPLICIT_CAUSAL_PATTERNS = [
  /\bimpact of\b/i,
  /\beffect of\b/i,
  /\bdid .* affect\b/i,
  /\bdid .* increase\b/i,
  /\bdid .* reduce\b/i,
  /\bdid .* decrease\b/i,
  /\bdid .* cause\b/i,
  /\bwhat caused\b/i,
  /\bcause of\b/i,
  /\bcaused by\b/i,
  /\bdriver of\b/i,
  /\bdrivers of\b/i,
  /\bif we\b/i,
  /\bif i\b/i,
];

const DIAGNOSTIC_EXPLANATION_PATTERNS = [
  /\bwhy did\b/i,
  /\bwhy does\b/i,
  /\bwhy is\b/i,
  /\bwhy are\b/i,
];

const MEDIATION_PATTERNS = [/\bmediate\b/i, /\bmediator\b/i, /\bmediation\b/i];
const IV_PATTERNS = [/\binstrumental variable\b/i, /\binstrument\b/i, /\biv\b/i];
const SELECTION_BIAS_PATTERNS = [/\bselection bias\b/i, /\bsample selection\b/i];

const DESCRIPTIVE_PATTERNS = [
  /\bwhat happened\b/i,
  /\bshow me\b/i,
  /\bsummarize\b/i,
  /\bsummary\b/i,
  /\btrend\b/i,
  /\bcount\b/i,
  /\bhow many\b/i,
  /\blist\b/i,
  /\bbreakdown\b/i,
  /\bdistribution\b/i,
  /\bwhich segment\b/i,
  /\bwhich segments\b/i,
  /\blast month\b/i,
  /\byesterday\b/i,
  /\bthis week\b/i,
];

const ASSOCIATIONAL_PATTERNS = [
  /\bassociated with\b/i,
  /\bcorrelat/i,
  /\brelated to\b/i,
  /\bwhich factors\b/i,
  /\bwhich variables\b/i,
  /\bfeature importance\b/i,
  /\bimportant features\b/i,
];

const PREDICTIVE_PATTERNS = [
  /\bpredict\b/i,
  /\bpredicts\b/i,
  /\bpredictive\b/i,
  /\bforecast\b/i,
  /\bforecasting\b/i,
  /\blikely to\b/i,
  /\bprobability of\b/i,
  /\bnext month\b/i,
  /\bnext quarter\b/i,
  /\bnext week\b/i,
];

export function buildCausalIntentPrompt(message: string) {
  return [
    "Classify the user request before any dataset analysis begins.",
    "Return strict JSON with: is_causal, intent_type, reason, confidence, question_type, routing_decision.",
    "Allowed intent_type: descriptive, associational, predictive, diagnostic, causal, counterfactual, unclear.",
    "Allowed routing_decision: continue_descriptive, open_predictive_analysis, open_causal_study, ask_clarification, blocked.",
    "Never use tools or dataset access while classifying.",
    `User message: ${message.trim()}`,
  ].join("\n");
}

function normalizeSuggestedLabel(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/[?.!,]+$/g, "") ?? "";

  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSuggestedLabels(message: string) {
  const effectMatch = message.match(/(?:effect|impact|influence) of (.+?) on (.+?)(?:\?|$)/i);
  if (effectMatch) {
    return {
      proposedOutcomeLabel: normalizeSuggestedLabel(effectMatch[2]),
      proposedTreatmentLabel: normalizeSuggestedLabel(effectMatch[1]),
    };
  }

  const affectMatch = message.match(/did (.+?) affect (.+?)(?:\?|$)/i);
  if (affectMatch) {
    return {
      proposedOutcomeLabel: normalizeSuggestedLabel(affectMatch[2]),
      proposedTreatmentLabel: normalizeSuggestedLabel(affectMatch[1]),
    };
  }

  const afterMatch = message.match(/why did (.+?) (?:drop|fall|rise|increase|decrease|change)(?: .*?)? after (.+?)(?:\?|$)/i);
  if (afterMatch) {
    return {
      proposedOutcomeLabel: normalizeSuggestedLabel(afterMatch[1]),
      proposedTreatmentLabel: normalizeSuggestedLabel(afterMatch[2]),
    };
  }

  const interventionMatch = message.match(/(?:what happens if we|if we) (?:increase|decrease|change|raise|lower|reduce|remove|add) (.+?)(?: by .+?)?(?:\?|$)/i);
  if (interventionMatch) {
    return {
      proposedOutcomeLabel: null,
      proposedTreatmentLabel: normalizeSuggestedLabel(interventionMatch[1]),
    };
  }

  const outcomeMatch = message.match(/why did (.+?) (?:drop|fall|rise|increase|decrease|change)(?: .*?)?(?:\?|$)/i);
  if (outcomeMatch) {
    return {
      proposedOutcomeLabel: normalizeSuggestedLabel(outcomeMatch[1]),
      proposedTreatmentLabel: null,
    };
  }

  return {
    proposedOutcomeLabel: null,
    proposedTreatmentLabel: null,
  };
}

function inferQuestionType(message: string): CausalQuestionType {
  if (matchesAny(message, MEDIATION_PATTERNS)) {
    return "mediation";
  }

  if (matchesAny(message, IV_PATTERNS)) {
    return "instrumental_variable";
  }

  if (matchesAny(message, SELECTION_BIAS_PATTERNS)) {
    return "selection_bias";
  }

  if (matchesAny(message, COUNTERFACTUAL_PATTERNS)) {
    return "counterfactual";
  }

  if (matchesAny(message, EXPLICIT_CAUSAL_PATTERNS)) {
    return "intervention_effect";
  }

  if (matchesAny(message, DIAGNOSTIC_EXPLANATION_PATTERNS)) {
    return "cause_of_observed_change";
  }

  return "other";
}

function buildHeuristicClassification(message: string): CausalIntentClassification {
  const normalized = normalizeMessage(message);
  const questionType = inferQuestionType(normalized);
  const suggestedLabels = extractSuggestedLabels(message);

  if (matchesAny(normalized, COUNTERFACTUAL_PATTERNS)) {
    const raw = {
      confidence: 0.95,
      intent_type: "counterfactual",
      is_causal: true,
      question_type: questionType,
      reason: "The request asks about the effect of changing an intervention.",
      routing_decision: "open_causal_study",
    } as const;

    return {
      confidence: raw.confidence,
      intentType: raw.intent_type,
      isCausal: raw.is_causal,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      questionType,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      routingDecision: raw.routing_decision,
    };
  }

  if (matchesAny(normalized, EXPLICIT_CAUSAL_PATTERNS)) {
    const raw = {
      confidence: 0.93,
      intent_type: "causal",
      is_causal: true,
      question_type: questionType,
      reason: "The request asks for an explicit intervention effect or causal attribution.",
      routing_decision: "open_causal_study",
    } as const;

    return {
      confidence: raw.confidence,
      intentType: raw.intent_type,
      isCausal: raw.is_causal,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      questionType,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      routingDecision: raw.routing_decision,
    };
  }

  if (matchesAny(normalized, PREDICTIVE_PATTERNS)) {
    const raw = {
      confidence: 0.91,
      intent_type: "predictive",
      is_causal: false,
      question_type: questionType,
      reason: "The request asks for prediction or forecasting rather than a causal effect estimate.",
      routing_decision: "open_predictive_analysis",
    } as const;

    return {
      confidence: raw.confidence,
      intentType: raw.intent_type,
      isCausal: raw.is_causal,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      questionType,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      routingDecision: raw.routing_decision,
    };
  }

  if (matchesAny(normalized, ASSOCIATIONAL_PATTERNS)) {
    const raw = {
      confidence: 0.87,
      intent_type: "associational",
      is_causal: false,
      question_type: questionType,
      reason: "The request asks for correlations or observational predictors rather than an intervention effect.",
      routing_decision: "open_predictive_analysis",
    } as const;

    return {
      confidence: raw.confidence,
      intentType: raw.intent_type,
      isCausal: raw.is_causal,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      questionType,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      routingDecision: raw.routing_decision,
    };
  }

  if (matchesAny(normalized, DIAGNOSTIC_EXPLANATION_PATTERNS)) {
    const raw = {
      confidence: 0.82,
      intent_type: "diagnostic",
      is_causal: false,
      question_type: questionType,
      reason: "The request asks for an explanation of an observed pattern and should start with observational diagnostic analysis.",
      routing_decision: "continue_descriptive",
    } as const;

    return {
      confidence: raw.confidence,
      intentType: raw.intent_type,
      isCausal: raw.is_causal,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      questionType,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      routingDecision: raw.routing_decision,
    };
  }

  if (matchesAny(normalized, DESCRIPTIVE_PATTERNS)) {
    const raw = {
      confidence: 0.9,
      intent_type: "descriptive",
      is_causal: false,
      question_type: questionType,
      reason: "The request asks what happened or for a descriptive summary, not why an outcome changed.",
      routing_decision: "continue_descriptive",
    } as const;

    return {
      confidence: raw.confidence,
      intentType: raw.intent_type,
      isCausal: raw.is_causal,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      questionType,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      routingDecision: raw.routing_decision,
    };
  }

  const raw = {
    confidence: 0.35,
    intent_type: "unclear",
    is_causal: false,
    question_type: questionType,
    reason: "The request is ambiguous about whether the user wants descriptive reporting or causal analysis.",
    routing_decision: "ask_clarification",
  } as const;

  return {
    confidence: raw.confidence,
    intentType: raw.intent_type,
    isCausal: raw.is_causal,
    proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
    proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
    questionType,
    rawOutputJson: JSON.stringify(raw),
    reason: raw.reason,
    routingDecision: raw.routing_decision,
  };
}

function buildSafeFallbackClassification(): CausalIntentClassification {
  const raw = {
    confidence: 0.2,
    intent_type: "unclear",
    is_causal: false,
    question_type: "other",
    reason: "The intake classifier could not safely determine intent without clarification.",
    routing_decision: "ask_clarification",
  } as const;

  return {
    confidence: raw.confidence,
    intentType: raw.intent_type,
    isCausal: raw.is_causal,
    proposedOutcomeLabel: null,
    proposedTreatmentLabel: null,
    questionType: raw.question_type,
    rawOutputJson: JSON.stringify(raw),
    reason: raw.reason,
    routingDecision: raw.routing_decision,
  };
}

export async function classifyCausalIntent(message: string): Promise<CausalIntentClassification> {
  const firstPass = buildHeuristicClassification(message);
  const parsed = parseClassifierOutput(firstPass.rawOutputJson);

  if (parsed) {
    return {
      confidence: parsed.confidence,
      intentType: parsed.intent_type,
      isCausal: parsed.is_causal,
      proposedOutcomeLabel: firstPass.proposedOutcomeLabel ?? null,
      proposedTreatmentLabel: firstPass.proposedTreatmentLabel ?? null,
      questionType: parsed.question_type ?? firstPass.questionType,
      rawOutputJson: firstPass.rawOutputJson,
      reason: parsed.reason,
      routingDecision: parsed.routing_decision ?? firstPass.routingDecision,
    };
  }

  const secondPass = buildHeuristicClassification(message);
  const reparsed = parseClassifierOutput(secondPass.rawOutputJson);

  if (reparsed) {
    return {
      confidence: reparsed.confidence,
      intentType: reparsed.intent_type,
      isCausal: reparsed.is_causal,
      proposedOutcomeLabel: secondPass.proposedOutcomeLabel ?? null,
      proposedTreatmentLabel: secondPass.proposedTreatmentLabel ?? null,
      questionType: reparsed.question_type ?? secondPass.questionType,
      rawOutputJson: secondPass.rawOutputJson,
      reason: reparsed.reason,
      routingDecision: reparsed.routing_decision ?? secondPass.routingDecision,
    };
  }

  return buildSafeFallbackClassification();
}

export function getCausalIntentClassifierMetadata() {
  return {
    descriptiveFallbackPath: DESCRIPTIVE_FALLBACK_PATH,
    modelName: CAUSAL_INTENT_MODEL_NAME,
    predictiveFallbackPath: PREDICTIVE_FALLBACK_PATH,
    promptVersion: CAUSAL_INTENT_PROMPT_VERSION,
  };
}
