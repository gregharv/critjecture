import type {
  ClarificationKind,
  GuardrailFlag,
} from "@/lib/analysis-routing-types";

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesAny(text: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const OBSERVATIONAL_PATTERN_CUES = [
  /\bassociated with\b/i,
  /\bcorrelat/i,
  /\brelated to\b/i,
  /\brelationship between\b/i,
  /\bstatistically significant\b/i,
  /\brobust\b/i,
  /\bwe (?:observed|found|identified|detected)\b/i,
  /\bas [^?.!]+ (?:drops?|falls?|rises?|increases?|decreases?)\b/i,
  /\bpattern in the data\b/i,
  /\bafter [a-z0-9_\-/ ]+ changed\b/i,
];

const INTERVENTION_CUES = [
  /\bwhat happens if\b/i,
  /\bwhat would happen if\b/i,
  /\bif we (?:increase|decrease|change|raise|lower|reduce|remove|add|cut)\b/i,
  /\beffect of\b/i,
  /\bimpact of\b/i,
  /\bhow can we (?:increase|decrease|reduce|improve|raise|lower)\b/i,
];

const MECHANISM_CUES = [
  /\bwhy\b/i,
  /\bexplain\b/i,
  /\bexplanation\b/i,
  /\bmechanism\b/i,
  /\bmechanisms\b/i,
  /\bpathway\b/i,
  /\bpathways\b/i,
  /\broot cause\b/i,
  /\bwhat drives\b/i,
  /\bwhat is driving\b/i,
  /\bthrough what process\b/i,
];

const DIRECTIONAL_PRESUPPOSITION_CUES = [
  /\bforces?\b/i,
  /\bmakes?\b/i,
  /\bcauses?\b/i,
  /\bdrives?\b/i,
  /\bdirect mechanism\b/i,
  /\bphysical pathway\b/i,
  /\bby which\b/i,
  /\bwhat (?:specific )?(?:mechanism|mechanisms|pathway|pathways)\b/i,
];

const ACTUAL_CAUSE_CUES = [
  /\bwas .* the reason\b/i,
  /\bbut for\b/i,
  /\bwould .* have happened without\b/i,
  /\bwould .* have been lower without\b/i,
  /\bwould .* have been higher without\b/i,
  /\bif we had not\b/i,
  /\bif i had not\b/i,
  /\bwould this still have happened\b/i,
];

const IDENTIFICATION_CUES = [
  /\bexperiment\b/i,
  /\brandomi[sz](?:ed|ation)?\b/i,
  /\bnatural experiment\b/i,
  /\binstrumental variable\b/i,
  /\bdiff(?:erence)?-in-diff(?:erence)?s?\b/i,
  /\bregression discontinuity\b/i,
  /\bidentified causal effect\b/i,
  /\bcounterfactual estimate\b/i,
  /\b(?:analysis|causal) study\b/i,
  /\brung-2 study\b/i,
  /\brung-3 study\b/i,
];

const HYPOTHESIS_BRAINSTORM_CUES = [
  /\bbrainstorm\b/i,
  /\bhypotheses\b/i,
  /\bconjectures\b/i,
  /\blist (?:possible|plausible)\b/i,
  /\beven if speculative\b/i,
  /\bas conjectures\b/i,
];

export type AnalysisPresuppositionClassification = {
  explicitHypothesisRequest: boolean;
  flag: GuardrailFlag;
  hasActualCauseCue: boolean;
  hasDirectionalPresupposition: boolean;
  hasIdentificationCue: boolean;
  hasInterventionCue: boolean;
  hasMechanismCue: boolean;
  hasObservationalCue: boolean;
};

export function classifyAnalysisPresupposition(message: string): AnalysisPresuppositionClassification {
  const normalized = normalizeText(message);
  const hasObservationalCue = matchesAny(normalized, OBSERVATIONAL_PATTERN_CUES);
  const hasInterventionCue = matchesAny(normalized, INTERVENTION_CUES);
  const hasMechanismCue = matchesAny(normalized, MECHANISM_CUES);
  const hasDirectionalPresupposition = matchesAny(normalized, DIRECTIONAL_PRESUPPOSITION_CUES);
  const hasActualCauseCue = matchesAny(normalized, ACTUAL_CAUSE_CUES);
  const hasIdentificationCue = matchesAny(normalized, IDENTIFICATION_CUES);
  const explicitHypothesisRequest = matchesAny(normalized, HYPOTHESIS_BRAINSTORM_CUES);

  let flag: GuardrailFlag = "none";

  if (hasObservationalCue && hasMechanismCue && hasDirectionalPresupposition && !hasIdentificationCue) {
    flag = "unsupported_direct_mechanism";
  } else if (hasObservationalCue && hasInterventionCue && !hasIdentificationCue) {
    flag = "unsupported_rung_jump";
  } else if (hasObservationalCue && hasActualCauseCue && !hasIdentificationCue) {
    flag = "unsupported_actual_cause_presupposition";
  }

  return {
    explicitHypothesisRequest,
    flag,
    hasActualCauseCue,
    hasDirectionalPresupposition,
    hasIdentificationCue,
    hasInterventionCue,
    hasMechanismCue,
    hasObservationalCue,
  };
}

export function buildGuardrailClarification(input: {
  flag: Exclude<GuardrailFlag, "none">;
  latestMessage: string;
}) {
  const normalized = normalizeText(input.latestMessage);

  if (input.flag === "unsupported_direct_mechanism") {
    return {
      clarificationKind: "presupposition_reframe" as ClarificationKind,
      epistemicPosture: "guardrail" as const,
      question: matchesAny(normalized, HYPOTHESIS_BRAINSTORM_CUES)
        ? "Do you want a short list of conjectural mechanisms only, clearly labeled as hypotheses rather than established causes?"
        : "Do you want to first check shared driver, confounding pattern, or omitted context alternatives and keep mechanisms as hypotheses only, or do you want to frame this as a higher-rung intervention/counterfactual study instead of assuming the mechanism is already established?",
    };
  }

  if (input.flag === "unsupported_actual_cause_presupposition") {
    return {
      clarificationKind: "rung_1_vs_rung_3" as ClarificationKind,
      epistemicPosture: "guardrail" as const,
      question:
        "Do you want an observational explanation of what was happening around this outcome, or do you want to frame it as a counterfactual question about whether the outcome would still have happened without that factor?",
    };
  }

  return {
    clarificationKind: "rung_1_vs_rung_2" as ClarificationKind,
    epistemicPosture: "guardrail" as const,
    question:
      "Do you want an observational read on what is associated with the outcome, or do you want to open an intervention study about what would happen if you changed this variable?",
  };
}
