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
  /\bhow does\b/i,
  /\bhow do\b/i,
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
  /\bwhere .* (?:causes?|leads? to|results? in|forces?|makes?)\b/i,
  /\bhow .* (?:causes?|leads? to|results? in|forces?|makes?)\b/i,
  /\bwhat (?:specific )?(?:mechanisms|pathways) .* (?:cause|causes|lead|leads|result|results|force|forces|make|makes)\b/i,
  /\bassuming .* (?:accurate|true|correct)\b/i,
];

const IDENTIFICATION_CUES = [
  /\bexperiment\b/i,
  /\brandomi[sz](?:ed|ation)?\b/i,
  /\bnatural experiment\b/i,
  /\binstrumental variable\b/i,
  /\binstrument\b/i,
  /\bdiff(?:erence)?-in-diff(?:erence)?s?\b/i,
  /\bregression discontinuity\b/i,
  /\bcausal (?:estimate|effect|design|identification|study|workspace)\b/i,
  /\bcounterfactual\b/i,
];

const HYPOTHESIS_BRAINSTORM_CUES = [
  /\bbrainstorm\b/i,
  /\bhypotheses\b/i,
  /\bconjectures\b/i,
  /\blist (?:possible|plausible)\b/i,
  /\beven if speculative\b/i,
  /\bas conjectures\b/i,
];

const CONCISE_CONCLUSION_CUES = [
  /\bjust\b.*\b(?:correlation|pattern|data)\b/i,
  /\bthere is a pattern\b/i,
  /\bthe pattern is real\b/i,
  /\blook at the correlation\b/i,
  /\blook at the data\b/i,
  /\bjust verify\b/i,
  /\bconcise\b/i,
  /\bshort answer\b/i,
  /\bnot .* speculative\b/i,
];

const SHARED_DRIVER_CUES = [/\bshared driver\b/i, /\bcommon driver\b/i, /\bconfound/i];
const AFFIRMATIVE_REPLY_CUES = [/^(yes|yeah|yep|sure|ok|okay|sounds good|do that|let's do that)\b/i];

export type ObservationalMechanismRequestClassification = {
  explicitHypothesisRequest: boolean;
  hasDirectionalPresupposition: boolean;
  hasIdentificationCue: boolean;
  hasMechanismCue: boolean;
  hasObservationalCue: boolean;
  kind: "loaded_mechanism_from_observation" | "none";
};

export type ObservationalMechanismReplyPreference =
  | "challenge_direct_framing"
  | "concise_observational_conclusion"
  | "hypothesis_brainstorm"
  | "none";

export function classifyObservationalMechanismRequest(
  message: string,
): ObservationalMechanismRequestClassification {
  const normalized = normalizeText(message);
  const hasObservationalCue = matchesAny(normalized, OBSERVATIONAL_PATTERN_CUES);
  const hasMechanismCue = matchesAny(normalized, MECHANISM_CUES);
  const hasDirectionalPresupposition = matchesAny(normalized, DIRECTIONAL_PRESUPPOSITION_CUES);
  const hasIdentificationCue = matchesAny(normalized, IDENTIFICATION_CUES);
  const explicitHypothesisRequest = matchesAny(normalized, HYPOTHESIS_BRAINSTORM_CUES);

  return {
    explicitHypothesisRequest,
    hasDirectionalPresupposition,
    hasIdentificationCue,
    hasMechanismCue,
    hasObservationalCue,
    kind:
      hasObservationalCue && hasMechanismCue && hasDirectionalPresupposition && !hasIdentificationCue
        ? "loaded_mechanism_from_observation"
        : "none",
  };
}

export function isLoadedMechanismReframeQuestion(question: string | null | undefined) {
  const normalized = normalizeText(question ?? "");

  if (!normalized) {
    return false;
  }

  return /\bshared driver\b|\bconfounding pattern\b|\bdirect-causation framing\b|\bdirect pathway\b|\bomitted context\b|\bcommon driver\b/i.test(
    normalized,
  );
}

export function classifyObservationalMechanismClarificationReply(input: {
  latestMessage: string;
  lastQuestion?: string | null;
}): ObservationalMechanismReplyPreference {
  const latest = normalizeText(input.latestMessage);

  if (!latest || !isLoadedMechanismReframeQuestion(input.lastQuestion)) {
    return "none";
  }

  if (matchesAny(latest, HYPOTHESIS_BRAINSTORM_CUES)) {
    return "hypothesis_brainstorm";
  }

  if (matchesAny(latest, SHARED_DRIVER_CUES)) {
    return "challenge_direct_framing";
  }

  if (matchesAny(latest, CONCISE_CONCLUSION_CUES)) {
    return "concise_observational_conclusion";
  }

  if (matchesAny(latest, AFFIRMATIVE_REPLY_CUES)) {
    return "challenge_direct_framing";
  }

  return "none";
}

export function buildObservationalMechanismPolicyInstruction(
  preference: Exclude<ObservationalMechanismReplyPreference, "none">,
) {
  if (preference === "hypothesis_brainstorm") {
    return "Treat this as observational hypothesis brainstorming only. Label any mechanisms as conjectures, keep the list short, and do not present any pathway as established from the observed pattern alone.";
  }

  if (preference === "challenge_direct_framing") {
    return "Treat this as a concise observational response. Confirm the pattern only if the data supports it, say the observational pattern alone does not establish a direct mechanism, and prioritize shared-driver, synchronized-demand, or omitted-context explanations over direct causal storytelling.";
  }

  return "Treat this as a concise observational response. Confirm the pattern only if the data supports it, say the observational pattern alone does not establish a direct mechanism, and give the shortest likely shared-driver, synchronized-demand, or omitted-context explanation instead of listing speculative pathways.";
}
