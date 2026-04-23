import type {
  AnalyticalClarificationClassification,
  AnalyticalClarificationKind as ClarificationKind,
  AnalyticalClarificationPosture as EpistemicPosture,
} from "@/lib/analytical-clarification-types";
import {
  buildObservationalMechanismPolicyInstruction,
  classifyObservationalMechanismClarificationReply,
  isLoadedMechanismReframeQuestion,
} from "@/lib/observational-mechanism-response-policy";

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const MONTH_NAME_PATTERN =
  "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec";

function hashText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function chooseVariant<T>(seed: string, variants: readonly T[]) {
  if (variants.length === 0) {
    throw new Error("chooseVariant requires at least one variant.");
  }

  return variants[hashText(seed) % variants.length] as T;
}

const STANDALONE_ANALYTICAL_REQUEST_PATTERNS = [
  /^(what|why|how|which|who|when)\b/i,
  /^(can|could|would|should) you\b/i,
  /^(please )?(summarize|show|explain|forecast|predict|analy[sz]e|investigat(?:e|ing)|explor(?:e|ing)|help me understand)\b/i,
  /\b(descriptive|diagnostic|predictive|causal|counterfactual|summary|forecast|prediction|explanation|mechanism)\b/i,
];

export function looksLikeStandaloneAnalyticalRequest(message: string) {
  const trimmed = message.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.includes("?") && trimmed.split(/\s+/).length >= 4) {
    return true;
  }

  if (trimmed.split(/\s+/).length >= 9) {
    return true;
  }

  return STANDALONE_ANALYTICAL_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function looksLikeShortClarificationReply(
  message: string,
  lastQuestion?: string | null,
  clarificationKind?: ClarificationKind | null,
) {
  const trimmed = message.trim();

  if (!trimmed) {
    return false;
  }

  const wordCount = trimmed.split(/\s+/).length;
  const loadedCausalFollowUp =
    (clarificationKind === "loaded_presupposition_reframe" ||
      (Boolean(lastQuestion) && isLoadedMechanismReframeQuestion(lastQuestion))) &&
    wordCount <= 18 &&
    !trimmed.includes("?") &&
    !STANDALONE_ANALYTICAL_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed));

  if (loadedCausalFollowUp) {
    return true;
  }

  return wordCount <= 8 && !looksLikeStandaloneAnalyticalRequest(trimmed);
}

function contextualizeClarificationReply(
  lastQuestion: string | null | undefined,
  latestMessage: string,
  clarificationKind?: ClarificationKind | null,
) {
  const question = lastQuestion?.trim() ?? "";
  const latest = latestMessage.trim();

  if (!latest || !looksLikeShortClarificationReply(latest, question, clarificationKind)) {
    return latest;
  }

  const observationalMechanismPreference = classifyObservationalMechanismClarificationReply({
    clarificationKind,
    lastQuestion: question,
    latestMessage: latest,
  });

  if (observationalMechanismPreference !== "none") {
    return buildObservationalMechanismPolicyInstruction(observationalMechanismPreference);
  }

  if (/\boverall level\b|\bbroken out\b|\bby something like region\b/i.test(question)) {
    if (/\boverall\b/i.test(latest)) {
      return `I want to start at the overall level first.`;
    }

    return `I want to break this out by ${latest.replace(/^(by\s+)/i, "").trim()}.`;
  }

  if (/\bdataset or file in mind\b|\bwhat data would actually let us answer it\b/i.test(question)) {
    if (/^(no|not yet|none)\b/i.test(latest)) {
      return "I do not have a dataset or file selected yet.";
    }

    return `I already have data in mind: ${latest}.`;
  }

  if (/\bwhat are you trying to predict\b/i.test(question)) {
    return `I want to predict ${latest}.`;
  }

  if (/\bwhat outcome are you asking about\b/i.test(question)) {
    return `The outcome I care about is ${latest}.`;
  }

  if (/\bwhat change or intervention\b/i.test(question)) {
    return `The change or intervention I want to evaluate is ${latest}.`;
  }

  if (/\bwhat outcome or metric\b|\bwhich metric or outcome\b/i.test(question)) {
    return `The metric or outcome to focus on is ${latest}.`;
  }

  if (/\bwhat prediction horizon\b|\bwhat time period\b|\bwhat time window\b/i.test(question)) {
    return `The time window that matters is ${latest}.`;
  }

  if (/\bwhat changed\b|\bquick picture of what changed\b/i.test(question)) {
    return `I want to first see what changed, focusing on ${latest}.`;
  }

  if (/\bexplain why\b|\btrying to explain\b|\bwhat outcome or metric are you trying to explain\b/i.test(question)) {
    return `I want to explain ${latest}.`;
  }

  return latest;
}

export function buildEffectiveAnalyticalPrompt(
  pendingContext: string | null | undefined,
  latestMessage: string,
  lastQuestion?: string | null,
  clarificationKind?: ClarificationKind | null,
) {
  const rawLatest = latestMessage.trim();
  const latest = contextualizeClarificationReply(lastQuestion, rawLatest, clarificationKind);
  const context = pendingContext?.trim() ?? "";

  if (!latest) {
    return context;
  }

  if (!context) {
    return latest;
  }

  if (looksLikeStandaloneAnalyticalRequest(rawLatest) && latest === rawLatest) {
    return rawLatest;
  }

  const normalizedLatest = normalizeText(latest);
  const normalizedContext = normalizeText(context);

  if (normalizedLatest.includes(normalizedContext)) {
    return latest;
  }

  if (normalizedContext.includes(normalizedLatest)) {
    return context;
  }

  return `${context}\n${latest}`;
}

export function extractAnalyticalTimeWindow(message: string) {
  const match = message.match(
    new RegExp(
      [
        "\\b(?:last month|last week|last quarter|last year|this month|this week|this quarter|this year|next month|next week|next quarter|next year|yesterday|today)\\b",
        `\\bin (?:${MONTH_NAME_PATTERN})(?: \\d{4})?\\b`,
        `\\bduring (?:${MONTH_NAME_PATTERN})(?: \\d{4})?\\b`,
        `\\bfor (?:${MONTH_NAME_PATTERN}) \\d{4}\\b`,
        "\\bin q[1-4]\\b",
        "\\bduring q[1-4](?: \\d{4})?\\b",
        "\\bfor q[1-4] \\d{4}\\b",
        "\\bin \\d{4}\\b",
        "\\bduring \\d{4}\\b",
        "\\bfor \\d{4}\\b",
      ].join("|"),
      "i",
    ),
  );

  return match?.[0]?.trim() ?? null;
}

export function extractAnalyticalGrouping(message: string) {
  const byMatch = message.match(/\bby ([a-z0-9_\-/ ]{2,40})(?:[?.!,]|$)/i);
  if (byMatch?.[1]) {
    return byMatch[1].trim();
  }

  const perMatch = message.match(/\bper ([a-z0-9_\-/ ]{2,40})(?:[?.!,]|$)/i);
  if (perMatch?.[1]) {
    return perMatch[1].trim();
  }

  const eachMatch = message.match(/\bfor each ([a-z0-9_\-/ ]{2,40})(?:[?.!,]|$)/i);
  if (eachMatch?.[1]) {
    return eachMatch[1].trim();
  }

  return null;
}

export function analyticalMessageMentionsData(message: string) {
  return /(dataset|csv|table|telemetry|uploaded|upload|file|columns?|spreadsheet|data)/i.test(message);
}

type AnalyticalGoal = "summary" | "explanation" | "predictive" | "causal" | null;
type EpistemicRisk = "standard" | "causal_overreach" | "predictive_vs_causal" | "data_feasibility";

function inferAnalyticalGoal(message: string): AnalyticalGoal {
  const normalized = normalizeText(message);

  if (
    /\b(causal|cause|caused|effect|impact|intervention|counterfactual|what happens if|would .* without|did .* affect)\b/i.test(
      normalized,
    )
  ) {
    return "causal";
  }

  if (
    /\b(why|explain|explanation|mechanism|mechanisms|pathway|pathways|root cause|what drove|what caused)\b/i.test(
      normalized,
    )
  ) {
    return "explanation";
  }

  if (/\b(predict|predictive|forecast|probability|likely to|associated with|correlat)\b/i.test(normalized)) {
    return "predictive";
  }

  if (/\b(summary|summarize|what happened|show me|overview|breakdown|trend|distribution|count)\b/i.test(normalized)) {
    return "summary";
  }

  return null;
}

function hasLoadedQuestionFraming(message: string) {
  const normalized = normalizeText(message);

  const hasMechanismCue = /\b(mechanism|mechanisms|pathway|pathways|force|forces|drives|caused by|causes|what caused|why does|why did)\b/i.test(
    normalized,
  );
  const hasObservationalCue = /\b(correlat|associated with|relationship between|statistically significant|robust|observed|found|identified|detected)\b/i.test(
    normalized,
  );
  const hasDirectionalPresupposition = /\b(forces?|direct mechanism|physical pathway|by which|assuming .* (accurate|true|correct))\b/i.test(
    normalized,
  );

  return hasMechanismCue && hasObservationalCue && hasDirectionalPresupposition;
}

function detectEpistemicRisk(input: {
  classification: AnalyticalClarificationClassification;
  goal: AnalyticalGoal;
  hasData: boolean;
  message: string;
}) {
  const normalized = normalizeText(input.message);
  const hasMechanismCue = /\b(mechanism|mechanisms|pathway|pathways|force|forces|drives|caused by|causes|what caused|why does|why did)\b/i.test(
    normalized,
  );
  const hasObservationalCue = /\b(correlat|associated with|relationship between|statistically significant|robust|observed|found|identified|detected)\b/i.test(
    normalized,
  );
  const asksWhatDataIsPossible = /\b(what data (do|would) (i|we) need|what data is available|what is possible with (this|the) data|what can (i|we) answer)\b/i.test(
    normalized,
  );

  if ((input.goal === "causal" || hasMechanismCue) && hasObservationalCue) {
    return "causal_overreach" as const;
  }

  if (input.goal === "predictive" && /\b(cause|causal|intervention|impact|effect)\b/i.test(normalized)) {
    return "predictive_vs_causal" as const;
  }

  if (asksWhatDataIsPossible || (!input.hasData && input.classification.intentType === "unclear")) {
    return "data_feasibility" as const;
  }

  return "standard" as const;
}

function resolveEpistemicPosture(input: {
  classification: AnalyticalClarificationClassification;
  previousPosture?: EpistemicPosture | null;
  risk: EpistemicRisk;
  goal: AnalyticalGoal;
}) {
  const currentPosture = (() => {
    if (input.risk === "causal_overreach" || input.goal === "causal") {
      return "guardrail" as const;
    }

    if (input.risk === "predictive_vs_causal" || input.goal === "predictive") {
      return "predictive" as const;
    }

    if (input.risk === "data_feasibility") {
      return "data_limited" as const;
    }

    if (input.classification.intentType === "diagnostic" || input.goal === "explanation") {
      return "diagnostic" as const;
    }

    return "exploratory" as const;
  })();

  if (
    currentPosture === "data_limited" &&
    input.previousPosture &&
    input.previousPosture !== "exploratory"
  ) {
    return input.previousPosture;
  }

  if (currentPosture !== "exploratory") {
    return currentPosture;
  }

  if (input.previousPosture && input.previousPosture !== "exploratory") {
    return input.previousPosture;
  }

  return currentPosture;
}

function buildEpistemicRiskLead(input: {
  posture: EpistemicPosture;
  seed: string;
}) {
  if (input.posture === "guardrail") {
    return chooseVariant(`${input.seed}:risk:causal-overreach`, [
      "Before we jump from a pattern to a causal story, I'd rather pin down what kind of answer you want.",
      "I don't want to overread an observed pattern as a causal explanation too quickly.",
      "Before we treat an observed pattern as a mechanism, let's pin down the kind of answer you're after.",
    ]);
  }

  if (input.posture === "predictive") {
    return chooseVariant(`${input.seed}:risk:predictive-vs-causal`, [
      "We can look at what predicts the outcome, but that's not automatically the same as what would change it.",
      "A rung-1 observational read and a higher-rung answer are different, so I'd like to pin down which one you want.",
      "Before we blur predictors with intervention claims, let's pin down the kind of answer you're after.",
    ]);
  }

  if (input.posture === "data_limited") {
    return chooseVariant(`${input.seed}:risk:data-feasibility`, [
      "Let's make sure we shape this around what the data can actually support.",
      "Before we over-commit, I'd like to pin down what question the available data can really answer.",
      "Let's first make sure the question and the likely data fit each other.",
    ]);
  }

  return "";
}

export function buildAnalyticalClarificationBannerEyebrow(posture: EpistemicPosture, message: string) {
  const seed = normalizeText(message);

  if (posture === "guardrail") {
    return chooseVariant(`${seed}:banner-eyebrow:causal-risk`, [
      "Checking the higher-rung framing",
      "Pressure-testing the causal story",
      "Checking higher-rung assumptions",
    ]);
  }

  if (posture === "predictive") {
    return chooseVariant(`${seed}:banner-eyebrow:predictive`, [
      "Separating rung-1 from higher-rung",
      "Clarifying the observational target",
      "Checking the rung-1 framing",
    ]);
  }

  if (posture === "data_limited") {
    return chooseVariant(`${seed}:banner-eyebrow:data-limited`, [
      "Checking data fit",
      "Clarifying what the data can support",
      "Aligning the question to the data",
    ]);
  }

  if (posture === "diagnostic") {
    return chooseVariant(`${seed}:banner-eyebrow:diagnostic`, [
      "Pinning down the explanation target",
      "Clarifying what needs explaining",
      "Narrowing the explanation target",
    ]);
  }

  return chooseVariant(`${seed}:banner-eyebrow:exploratory`, [
    "Clarifying the request",
    "Tightening the question",
    "Pinning down the framing",
  ]);
}

export function buildAnalyticalClarificationBannerLead(
  posture: EpistemicPosture,
  message: string,
) {
  const seed = normalizeText(message);

  if (posture === "guardrail") {
    return chooseVariant(`${seed}:banner:causal-risk`, [
      "Before I analyze this, I want to pressure-test the higher-rung framing a bit.",
      "Before I analyze this, I want to check whether this really needs a causal framing before we run with it.",
      "Before I analyze this, I want to make sure we are not jumping from a pattern to a higher-rung story too quickly.",
    ]);
  }

  if (posture === "predictive") {
    return chooseVariant(`${seed}:banner:predictive`, [
      "Before I analyze this, I want to separate a rung-1 observational read from a higher-rung claim.",
      "Before I analyze this, I want to pin down whether you want an observational read or a higher-rung one.",
      "Before I analyze this, I want to be clear on whether we're forecasting an outcome or asking what would change it.",
    ]);
  }

  if (posture === "data_limited") {
    return chooseVariant(`${seed}:banner:data-limited`, [
      "Before I analyze this, I want to make sure we're shaping it around what the data can support.",
      "Before I analyze this, I want to make sure the question fits the data we likely have.",
      "Before I analyze this, I want to pin down the question in a way the available data can actually answer.",
    ]);
  }

  if (posture === "diagnostic") {
    return chooseVariant(`${seed}:banner:diagnostic`, [
      "Before I analyze this, I want to pin down what exactly we're trying to explain.",
      "Before I analyze this, I want to narrow the explanation target a bit.",
      "Before I analyze this, I want to make sure we're precise about what needs explaining.",
    ]);
  }

  return chooseVariant(`${seed}:banner:exploratory`, [
    "Before I analyze this, I want to pin down the framing a bit.",
    "Before I analyze this, I want to make the framing a little more precise.",
    "Before I analyze this, I want to tighten up the question a bit.",
  ]);
}

function buildConversationalContextLead(input: {
  metric: string | null;
  timeWindow: string | null;
  grouping: string | null;
  hasData: boolean;
  seed: string;
}) {
  const focusParts: string[] = [];

  if (input.metric) {
    focusParts.push(input.metric);
  }

  if (input.timeWindow) {
    focusParts.push(input.timeWindow);
  }

  if (input.grouping) {
    focusParts.push(`by ${input.grouping}`);
  }

  if (focusParts.length > 0) {
    return chooseVariant(`${input.seed}:lead:focus`, [
      `Got it — you're looking at ${focusParts.join(" ")}.`,
      `Understood — you're focused on ${focusParts.join(" ")}.`,
      `Okay — this seems to be about ${focusParts.join(" ")}.`,
    ]);
  }

  if (input.hasData) {
    return chooseVariant(`${input.seed}:lead:data`, [
      "Got it — you already have data in mind.",
      "Understood — you already have data to work with.",
      "Okay — it sounds like you already have some data in mind.",
    ]);
  }

  return "";
}

export type ClarificationIntent = {
  classification: AnalyticalClarificationClassification;
  clarificationKind: ClarificationKind;
  epistemicPosture: EpistemicPosture;
  goal: AnalyticalGoal;
  grouping: string | null;
  hasData: boolean;
  loadedQuestionFraming: boolean;
  message: string;
  metric: string | null;
  previousPosture?: EpistemicPosture | null;
  risk: EpistemicRisk;
  seed: string;
  timeWindow: string | null;
};

function resolveClarificationKind(input: {
  goal: AnalyticalGoal;
  grouping: string | null;
  hasData: boolean;
  loadedQuestionFraming: boolean;
  metric: string | null;
  posture: EpistemicPosture;
  timeWindow: string | null;
}) {
  if (input.posture === "guardrail" && input.loadedQuestionFraming) {
    return "loaded_presupposition_reframe" as const;
  }

  if (!input.goal) {
    return "goal_disambiguation" as const;
  }

  if (!input.metric) {
    return "metric_needed" as const;
  }

  if (!input.timeWindow) {
    return "time_window_needed" as const;
  }

  if (!input.grouping) {
    return "grouping_needed" as const;
  }

  if (!input.hasData) {
    return "data_source_needed" as const;
  }

  return "next_detail" as const;
}

export function buildClarificationIntent(
  message: string,
  classification: AnalyticalClarificationClassification,
  previousPosture?: EpistemicPosture | null,
): ClarificationIntent {
  const metric = classification.proposedOutcomeLabel ?? null;
  const timeWindow = extractAnalyticalTimeWindow(message);
  const grouping = extractAnalyticalGrouping(message);
  const hasData = analyticalMessageMentionsData(message);
  const goal = inferAnalyticalGoal(message);
  const seed = normalizeText(message);
  const risk = detectEpistemicRisk({
    classification,
    goal,
    hasData,
    message,
  });
  const posture = resolveEpistemicPosture({
    classification,
    previousPosture,
    risk,
    goal,
  });
  const loadedQuestionFraming = hasLoadedQuestionFraming(message);

  return {
    classification,
    clarificationKind: resolveClarificationKind({
      goal,
      grouping,
      hasData,
      loadedQuestionFraming,
      metric,
      posture,
      timeWindow,
    }),
    epistemicPosture: posture,
    goal,
    grouping,
    hasData,
    loadedQuestionFraming,
    message,
    metric,
    previousPosture,
    risk,
    seed,
    timeWindow,
  };
}

export function buildDeterministicClarificationQuestion(intent: ClarificationIntent) {
  const lead = buildConversationalContextLead({
    grouping: intent.grouping,
    hasData: intent.hasData,
    metric: intent.metric,
    seed: intent.seed,
    timeWindow: intent.timeWindow,
  });
  const riskLead = buildEpistemicRiskLead({
    posture: intent.epistemicPosture,
    seed: intent.seed,
  });

  const withLead = (question: string) => [lead, riskLead, question].filter(Boolean).join(" ");
  const result = (question: string) => ({
    epistemicPosture: intent.epistemicPosture,
    question: withLead(question),
  });

  if (intent.clarificationKind === "loaded_presupposition_reframe") {
    return result(
      chooseVariant(`${intent.seed}:loaded-question`, [
        "Do you want to first test whether this relationship could be explained by a shared driver or confounding pattern, or are you only asking for plausible mechanism hypotheses?",
        "Would it be more useful to first challenge the direct-causation framing and check for alternative explanations, or should I only outline mechanism hypotheses as conjectures?",
        "Before we assume a direct pathway, do you want to first check whether the pattern could reflect omitted context or a common driver, or are you asking only for possible mechanisms?",
      ]),
    );
  }

  if (intent.clarificationKind === "goal_disambiguation") {
    if (intent.metric && intent.timeWindow && intent.grouping) {
      return result(
        chooseVariant(`${intent.seed}:unclear:metric-time-grouping`, [
          `Are you mainly trying to explain why ${intent.metric} changed, or would it be more useful to first see what changed by ${intent.grouping}?`,
          `Would it help more to explain why ${intent.metric} moved, or to first map what changed by ${intent.grouping}?`,
          `Do you want to get into why ${intent.metric} changed, or start by seeing how it shifted by ${intent.grouping}?`,
        ]),
      );
    }

    if (intent.metric && intent.timeWindow) {
      return result(
        chooseVariant(`${intent.seed}:unclear:metric-time`, [
          `Are you trying to explain why ${intent.metric} changed in ${intent.timeWindow}, or do you want a quick picture of what changed first?`,
          `Do you want to understand why ${intent.metric} moved in ${intent.timeWindow}, or would a quick view of what changed be more useful first?`,
          `Should we start with why ${intent.metric} changed in ${intent.timeWindow}, or first get a quick read on what changed?`,
        ]),
      );
    }

    if (intent.metric) {
      return result(
        chooseVariant(`${intent.seed}:unclear:metric`, [
          `Are you trying to explain a change in ${intent.metric}, get a quick summary of it, figure out what predicts it, or test whether something would change it?`,
          `Would you like a quick summary of ${intent.metric}, an explanation for a change in it, a look at what predicts it, or a higher-rung read on what would change it?`,
          `Are you mostly after a summary of ${intent.metric}, an explanation for it, an observational view of it, or a higher-rung answer about what would change it?`,
        ]),
      );
    }

    return result(
      chooseVariant(`${intent.seed}:unclear:general`, [
        "What are you most trying to understand here—what changed, what might explain a pattern, what predicts something, or whether something would change it?",
        "What would be most useful here: a quick summary of what changed, an explanation for a pattern, an observational read, or a higher-rung answer?",
        "Are you trying to figure out what happened, what might explain it, what predicts it, or what would change it under a different action?",
      ]),
    );
  }

  if (intent.clarificationKind === "metric_needed") {
    if (intent.goal === "predictive") {
      return result(
        chooseVariant(`${intent.seed}:predictive:metric`, [
          "What are you trying to predict?",
          "What outcome are you trying to predict?",
          "Which metric are you trying to forecast or predict?",
        ]),
      );
    }

    if (intent.goal === "causal") {
      return result(
        chooseVariant(`${intent.seed}:causal:metric`, [
          "What outcome are you asking about, and what change or intervention do you want to evaluate?",
          "What outcome do you care about here, and what change or intervention are you trying to assess?",
          "Which outcome matters here, and what action or intervention do you want to test against it?",
        ]),
      );
    }

    if (intent.goal === "explanation") {
      return result(
        chooseVariant(`${intent.seed}:explanation:metric`, [
          "What outcome or metric are you trying to explain?",
          "Which metric are you trying to make sense of?",
          "What outcome should we focus on explaining?",
        ]),
      );
    }

    return result(
      chooseVariant(`${intent.seed}:summary:metric`, [
        "Which metric or outcome should we focus on?",
        "What metric should we center this on?",
        "Which outcome do you want to focus on first?",
      ]),
    );
  }

  if (intent.clarificationKind === "time_window_needed") {
    if (intent.goal === "predictive") {
      return result(
        chooseVariant(`${intent.seed}:predictive:time`, [
          `What prediction horizon or time period matters most for ${intent.metric}?`,
          `What forecast horizon should we use for ${intent.metric}?`,
          `What time period matters most for predicting ${intent.metric}?`,
        ]),
      );
    }

    if (intent.goal === "causal") {
      return result(
        chooseVariant(`${intent.seed}:causal:time`, [
          `What time window should we use to evaluate the effect on ${intent.metric}?`,
          `Over what time period do you want to evaluate the effect on ${intent.metric}?`,
          `What window should we use for judging any effect on ${intent.metric}?`,
        ]),
      );
    }

    if (intent.goal === "explanation") {
      return result(
        chooseVariant(`${intent.seed}:explanation:time`, [
          `What time period or event window matters for understanding ${intent.metric}?`,
          `What time window should we focus on to make sense of ${intent.metric}?`,
          `Is there a particular period or event window that matters for ${intent.metric}?`,
        ]),
      );
    }

    return result(
      chooseVariant(`${intent.seed}:summary:time`, [
        `What time period should we focus on for ${intent.metric}?`,
        `What window do you want to look at for ${intent.metric}?`,
        `Which time period matters most for ${intent.metric}?`,
      ]),
    );
  }

  if (intent.clarificationKind === "grouping_needed") {
    if (intent.goal === "predictive") {
      return result(
        chooseVariant(`${intent.seed}:predictive:grouping`, [
          `Do you want to predict ${intent.metric} overall, or broken out by something like region, segment, or customer type?`,
          `Should the prediction for ${intent.metric} stay at the overall level, or be broken out by something like region, segment, or customer type?`,
          `Do you want one overall prediction for ${intent.metric}, or separate predictions by something like region, segment, or customer type?`,
        ]),
      );
    }

    return result(
      chooseVariant(`${intent.seed}:summary:grouping`, [
        `Do you want the answer at the overall level, or broken out by something like region, segment, or customer type?`,
        `Should we keep this at the overall level, or split it out by something like region, segment, or customer type?`,
        `Do you want the first pass overall, or broken out by something like region, segment, or customer type?`,
      ]),
    );
  }

  if (intent.clarificationKind === "data_source_needed") {
    return result(
      chooseVariant(`${intent.seed}:data`, [
        "Do you already have a dataset or file in mind for this, or should we first figure out what data would actually let us answer it?",
        "Do you already know which dataset or file you want to use, or should we first sort out what data would let us answer this well?",
        "Do you already have a file or dataset for this, or do you want to first pin down what data we would need?",
      ]),
    );
  }

  return result(
    chooseVariant(`${intent.seed}:final`, [
      "What feels like the next most important thing to pin down before we analyze this?",
      "Before we dig in, what feels like the next detail we should settle?",
      "What would help most to pin down next before we analyze it?",
    ]),
  );
}

export function buildConversationalClarificationQuestion(
  message: string,
  classification: AnalyticalClarificationClassification,
  previousPosture?: EpistemicPosture | null,
) {
  return buildDeterministicClarificationQuestion(
    buildClarificationIntent(message, classification, previousPosture),
  );
}
