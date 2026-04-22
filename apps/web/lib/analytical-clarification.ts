import type { CausalIntentClassification, EpistemicPosture } from "@/lib/causal-intent-types";

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

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

function looksLikeShortClarificationReply(message: string) {
  const trimmed = message.trim();

  if (!trimmed) {
    return false;
  }

  return trimmed.split(/\s+/).length <= 8 && !looksLikeStandaloneAnalyticalRequest(trimmed);
}

function contextualizeClarificationReply(lastQuestion: string | null | undefined, latestMessage: string) {
  const question = lastQuestion?.trim() ?? "";
  const latest = latestMessage.trim();

  if (!question || !latest || !looksLikeShortClarificationReply(latest)) {
    return latest;
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
) {
  const rawLatest = latestMessage.trim();
  const latest = contextualizeClarificationReply(lastQuestion, rawLatest);
  const context = pendingContext?.trim() ?? "";

  if (!latest) {
    return context;
  }

  if (!context) {
    return latest;
  }

  if (looksLikeStandaloneAnalyticalRequest(rawLatest)) {
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
    /\b(last month|last week|last quarter|last year|this month|this week|this quarter|this year|next month|next week|next quarter|next year|yesterday|today|in \w+|during \w+ \d{4}|during \w+|for \w+ \d{4})\b/i,
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

function detectEpistemicRisk(input: {
  classification: CausalIntentClassification;
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
  classification: CausalIntentClassification;
  previousPosture?: EpistemicPosture | null;
  risk: EpistemicRisk;
  goal: AnalyticalGoal;
}) {
  const currentPosture = (() => {
    if (input.risk === "causal_overreach" || input.goal === "causal") {
      return "causal_risk" as const;
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
  if (input.posture === "causal_risk") {
    return chooseVariant(`${input.seed}:risk:causal-overreach`, [
      "Before we jump from a pattern to a causal story, I'd rather pin down what kind of answer you want.",
      "I don't want to overread an observed pattern as a causal explanation too quickly.",
      "Before we treat an observed pattern as a mechanism, let's pin down the kind of answer you're after.",
    ]);
  }

  if (input.posture === "predictive") {
    return chooseVariant(`${input.seed}:risk:predictive-vs-causal`, [
      "We can look at what predicts the outcome, but that's not automatically the same as what causes it.",
      "A predictive read and a causal read are different, so I'd like to pin down which one you want.",
      "Before we blur predictors with causes, let's pin down the kind of answer you're after.",
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

export function buildConversationalClarificationQuestion(
  message: string,
  classification: CausalIntentClassification,
  previousPosture?: EpistemicPosture | null,
) {
  const metric = classification.proposedOutcomeLabel ?? null;
  const timeWindow = extractAnalyticalTimeWindow(message);
  const grouping = extractAnalyticalGrouping(message);
  const hasData = analyticalMessageMentionsData(message);
  const goal = inferAnalyticalGoal(message);
  const seed = normalizeText(message);
  const lead = buildConversationalContextLead({
    metric,
    timeWindow,
    grouping,
    hasData,
    seed,
  });
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
  const riskLead = buildEpistemicRiskLead({
    posture,
    seed,
  });

  const withLead = (question: string) => [lead, riskLead, question].filter(Boolean).join(" ");
  const result = (question: string) => ({
    epistemicPosture: posture,
    question: withLead(question),
  });

  if (!goal) {
    if (metric && timeWindow && grouping) {
      return result(
        chooseVariant(`${seed}:unclear:metric-time-grouping`, [
          `Are you mainly trying to explain why ${metric} changed, or would it be more useful to first see what changed by ${grouping}?`,
          `Would it help more to explain why ${metric} moved, or to first map what changed by ${grouping}?`,
          `Do you want to get into why ${metric} changed, or start by seeing how it shifted by ${grouping}?`,
        ]),
      );
    }

    if (metric && timeWindow) {
      return result(
        chooseVariant(`${seed}:unclear:metric-time`, [
          `Are you trying to explain why ${metric} changed in ${timeWindow}, or do you want a quick picture of what changed first?`,
          `Do you want to understand why ${metric} moved in ${timeWindow}, or would a quick view of what changed be more useful first?`,
          `Should we start with why ${metric} changed in ${timeWindow}, or first get a quick read on what changed?`,
        ]),
      );
    }

    if (metric) {
      return result(
        chooseVariant(`${seed}:unclear:metric`, [
          `Are you trying to explain a change in ${metric}, get a quick summary of it, figure out what predicts it, or test whether something caused it?`,
          `Would you like a quick summary of ${metric}, an explanation for a change in it, a look at what predicts it, or a causal read on whether something drove it?`,
          `Are you mostly after a summary of ${metric}, an explanation for it, a predictive view of it, or a causal answer about what changed it?`,
        ]),
      );
    }

    return result(
      chooseVariant(`${seed}:unclear:general`, [
        "What are you most trying to understand here—what changed, what might explain a pattern, what predicts something, or whether something caused it?",
        "What would be most useful here: a quick summary of what changed, an explanation for a pattern, a predictive read, or a causal answer?",
        "Are you trying to figure out what happened, what might explain it, what predicts it, or whether something actually caused it?",
      ]),
    );
  }

  if (!metric) {
    if (goal === "predictive") {
      return result(
        chooseVariant(`${seed}:predictive:metric`, [
          "What are you trying to predict?",
          "What outcome are you trying to predict?",
          "Which metric are you trying to forecast or predict?",
        ]),
      );
    }

    if (goal === "causal") {
      return result(
        chooseVariant(`${seed}:causal:metric`, [
          "What outcome are you asking about, and what change or intervention do you want to evaluate?",
          "What outcome do you care about here, and what change or intervention are you trying to assess?",
          "Which outcome matters here, and what action or intervention do you want to test against it?",
        ]),
      );
    }

    if (goal === "explanation") {
      return result(
        chooseVariant(`${seed}:explanation:metric`, [
          "What outcome or metric are you trying to explain?",
          "Which metric are you trying to make sense of?",
          "What outcome should we focus on explaining?",
        ]),
      );
    }

    return result(
      chooseVariant(`${seed}:summary:metric`, [
        "Which metric or outcome should we focus on?",
        "What metric should we center this on?",
        "Which outcome do you want to focus on first?",
      ]),
    );
  }

  if (!timeWindow) {
    if (goal === "predictive") {
      return result(
        chooseVariant(`${seed}:predictive:time`, [
          `What prediction horizon or time period matters most for ${metric}?`,
          `What forecast horizon should we use for ${metric}?`,
          `What time period matters most for predicting ${metric}?`,
        ]),
      );
    }

    if (goal === "causal") {
      return result(
        chooseVariant(`${seed}:causal:time`, [
          `What time window should we use to evaluate the effect on ${metric}?`,
          `Over what time period do you want to evaluate the effect on ${metric}?`,
          `What window should we use for judging any effect on ${metric}?`,
        ]),
      );
    }

    if (goal === "explanation") {
      return result(
        chooseVariant(`${seed}:explanation:time`, [
          `What time period or event window matters for understanding ${metric}?`,
          `What time window should we focus on to make sense of ${metric}?`,
          `Is there a particular period or event window that matters for ${metric}?`,
        ]),
      );
    }

    return result(
      chooseVariant(`${seed}:summary:time`, [
        `What time period should we focus on for ${metric}?`,
        `What window do you want to look at for ${metric}?`,
        `Which time period matters most for ${metric}?`,
      ]),
    );
  }

  if (!grouping) {
    if (goal === "predictive") {
      return result(
        chooseVariant(`${seed}:predictive:grouping`, [
          `Do you want to predict ${metric} overall, or broken out by something like region, segment, or customer type?`,
          `Should the prediction for ${metric} stay at the overall level, or be broken out by something like region, segment, or customer type?`,
          `Do you want one overall prediction for ${metric}, or separate predictions by something like region, segment, or customer type?`,
        ]),
      );
    }

    return result(
      chooseVariant(`${seed}:summary:grouping`, [
        `Do you want the answer at the overall level, or broken out by something like region, segment, or customer type?`,
        `Should we keep this at the overall level, or split it out by something like region, segment, or customer type?`,
        `Do you want the first pass overall, or broken out by something like region, segment, or customer type?`,
      ]),
    );
  }

  if (!hasData) {
    return result(
      chooseVariant(`${seed}:data`, [
        "Do you already have a dataset or file in mind for this, or should we first figure out what data would actually let us answer it?",
        "Do you already know which dataset or file you want to use, or should we first sort out what data would let us answer this well?",
        "Do you already have a file or dataset for this, or do you want to first pin down what data we would need?",
      ]),
    );
  }

  return result(
    chooseVariant(`${seed}:final`, [
      "What feels like the next most important thing to pin down before we analyze this?",
      "Before we dig in, what feels like the next detail we should settle?",
      "What would help most to pin down next before we analyze it?",
    ]),
  );
}
