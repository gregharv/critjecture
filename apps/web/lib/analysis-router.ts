import {
  ANALYSIS_ROUTER_MODEL_NAME,
  ANALYSIS_ROUTER_PROMPT_VERSION,
  type AnalysisRoutingClassification,
  parseAnalysisClassifierOutput,
  RUNG1_FALLBACK_PATH,
  type RequiredRung,
  type RoutingDecision,
  type TaskForm,
} from "@/lib/analysis-routing-types";
import { classifyAnalysisPresupposition } from "@/lib/analysis-presupposition-guardrail";

function normalizeMessage(message: string) {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesAny(text: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const ORDINARY_CHAT_PATTERNS = [
  /\bwhat is\b/i,
  /\bexplain\b/i,
  /\bcompare\b/i,
  /\bteach me\b/i,
  /\bcritique\b/i,
  /\bpearl'?s ladder\b/i,
  /\bcausal inference\b/i,
  /\bcounterfactual reasoning\b/i,
  /\bwhat is causation\b/i,
];

const DATASET_ANALYSIS_PATTERNS = [
  /\bwhat happened\b/i,
  /\bsummarize\b/i,
  /\bsummary\b/i,
  /\btrend\b/i,
  /\bcount\b/i,
  /\bbreakdown\b/i,
  /\bdistribution\b/i,
  /\bcorrelat/i,
  /\bassociated with\b/i,
  /\bpredict\b/i,
  /\bforecast\b/i,
  /\bwhy did\b/i,
  /\bwhy does\b/i,
  /\bwhat happens if\b/i,
  /\beffect of\b/i,
  /\bimpact of\b/i,
  /\bwould .* without\b/i,
  /\bbut for\b/i,
  /\bdataset\b/i,
  /\bdata\b/i,
  /\bcsv\b/i,
  /\btable\b/i,
  /\bfile\b/i,
];

const RUNG2_PATTERNS = [
  /\bwhat happens if\b/i,
  /\bwhat would happen if\b/i,
  /\bwhat will happen if\b/i,
  /\bif we (?:increase|decrease|change|raise|lower|reduce|remove|add|cut)\b/i,
  /\beffect of\b/i,
  /\bimpact of\b/i,
  /\bdid .* affect\b/i,
  /\bdid .* increase\b/i,
  /\bdid .* reduce\b/i,
  /\bdid .* decrease\b/i,
  /\bhow can we (?:increase|decrease|reduce|improve|raise|lower)\b/i,
];

const RUNG3_PATTERNS = [
  /\bcounterfactual\b/i,
  /\bbut for\b/i,
  /\bwas .* the reason\b/i,
  /\bwould .* have happened without\b/i,
  /\bwould .* have been lower without\b/i,
  /\bwould .* have been higher without\b/i,
  /\bif we had not\b/i,
  /\bif i had not\b/i,
  /\bwould this still have happened\b/i,
];

const PREDICT_PATTERNS = [
  /\bpredict\b/i,
  /\bpredictive\b/i,
  /\bforecast\b/i,
  /\blikely to\b/i,
  /\bprobability of\b/i,
  /\bnext month\b/i,
  /\bnext quarter\b/i,
  /\bnext week\b/i,
];

const DESCRIBE_PATTERNS = [
  /\bwhat happened\b/i,
  /\bsummarize\b/i,
  /\bsummary\b/i,
  /\bshow me\b/i,
  /\bcount\b/i,
  /\bbreakdown\b/i,
  /\bdistribution\b/i,
  /\boverview\b/i,
];

const EXPLAIN_PATTERNS = [
  /\bwhy\b/i,
  /\bexplain\b/i,
  /\bmechanism\b/i,
  /\bpathway\b/i,
  /\broot cause\b/i,
  /\bwhat drives\b/i,
];

const ADVISE_PATTERNS = [
  /\bhow can we\b/i,
  /\bwhat should we do\b/i,
  /\bhow should we\b/i,
  /\bwhich lever\b/i,
];

const COMPARE_PATTERNS = [/\bcompare\b/i, /\bversus\b/i, /\bvs\.?\b/i];
const CRITIQUE_PATTERNS = [/\bcritique\b/i, /\bmain critique\b/i, /\bwhat is wrong with\b/i];

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

function normalizeSuggestedFocusLabel(value: string | null | undefined) {
  const normalized = normalizeSuggestedLabel(value);

  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/\bby [a-z0-9_\-/ ]+\s*$/i, "")
    .replace(/\bper [a-z0-9_\-/ ]+\s*$/i, "")
    .replace(/\b(last|this|next)\s+(month|week|quarter|year)\b\s*$/i, "")
    .replace(/\b(yesterday|today)\b\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSuggestedLabels(message: string) {
  const effectMatch = message.match(/(?:effect|impact|influence) of (.+?) on (.+?)(?:\?|$)/i);
  if (effectMatch) {
    return {
      proposedFocusLabel: normalizeSuggestedFocusLabel(effectMatch[2]),
      proposedOutcomeLabel: normalizeSuggestedLabel(effectMatch[2]),
      proposedTreatmentLabel: normalizeSuggestedLabel(effectMatch[1]),
    };
  }

  const affectMatch = message.match(/did (.+?) affect (.+?)(?:\?|$)/i);
  if (affectMatch) {
    return {
      proposedFocusLabel: normalizeSuggestedFocusLabel(affectMatch[2]),
      proposedOutcomeLabel: normalizeSuggestedLabel(affectMatch[2]),
      proposedTreatmentLabel: normalizeSuggestedLabel(affectMatch[1]),
    };
  }

  const interventionMatch = message.match(
    /(?:what happens if we|if we) (?:increase|decrease|change|raise|lower|reduce|remove|add|cut) (.+?)(?: by .+?)?(?:\?|$)/i,
  );
  if (interventionMatch) {
    return {
      proposedFocusLabel: null,
      proposedOutcomeLabel: null,
      proposedTreatmentLabel: normalizeSuggestedLabel(interventionMatch[1]),
    };
  }

  const outcomeMatch = message.match(/why did (.+?) (?:drop|fall|rise|increase|decrease|change)(?: .*?)?(?:\?|$)/i);
  if (outcomeMatch) {
    return {
      proposedFocusLabel: normalizeSuggestedFocusLabel(outcomeMatch[1]),
      proposedOutcomeLabel: normalizeSuggestedLabel(outcomeMatch[1]),
      proposedTreatmentLabel: null,
    };
  }

  const focusMatch = message.match(
    /(?:help me understand|understand|analy[sz]e|investigat(?:e|ing)|explor(?:e|ing)|look into|dig into|forecast|predict) (.+?)(?:\?|$)/i,
  );
  if (focusMatch) {
    return {
      proposedFocusLabel: normalizeSuggestedFocusLabel(focusMatch[1]),
      proposedOutcomeLabel: normalizeSuggestedFocusLabel(focusMatch[1]),
      proposedTreatmentLabel: null,
    };
  }

  return {
    proposedFocusLabel: null,
    proposedOutcomeLabel: null,
    proposedTreatmentLabel: null,
  };
}

function inferTaskForm(message: string): TaskForm {
  if (matchesAny(message, CRITIQUE_PATTERNS)) {
    return "critique";
  }

  if (matchesAny(message, COMPARE_PATTERNS)) {
    return "compare";
  }

  if (matchesAny(message, ADVISE_PATTERNS)) {
    return "advise";
  }

  if (matchesAny(message, PREDICT_PATTERNS)) {
    return "predict";
  }

  if (matchesAny(message, EXPLAIN_PATTERNS)) {
    return "explain";
  }

  if (matchesAny(message, DESCRIBE_PATTERNS)) {
    return "describe";
  }

  if (/\b(what is|teach|explain)\b/i.test(message)) {
    return "teach";
  }

  return "unknown";
}

function inferRequiredRung(message: string): RequiredRung | null {
  if (matchesAny(message, RUNG3_PATTERNS)) {
    return "rung_3_counterfactual";
  }

  if (matchesAny(message, RUNG2_PATTERNS)) {
    return "rung_2_interventional";
  }

  if (matchesAny(message, DATASET_ANALYSIS_PATTERNS)) {
    return "rung_1_observational";
  }

  return null;
}

function looksLikeOrdinaryChat(message: string) {
  return matchesAny(message, ORDINARY_CHAT_PATTERNS) && !matchesAny(message, DATASET_ANALYSIS_PATTERNS);
}

function buildHeuristicClassification(message: string): AnalysisRoutingClassification {
  const normalized = normalizeMessage(message);
  const suggestedLabels = extractSuggestedLabels(message);
  const guardrail = classifyAnalysisPresupposition(normalized);
  const taskForm = inferTaskForm(normalized);

  if (looksLikeOrdinaryChat(normalized)) {
    const raw = {
      analysis_mode: "ordinary_chat",
      confidence: 0.9,
      guardrail_flag: "none",
      reason: "The request is conceptual or explanatory chat, not a dataset-backed analytical ask.",
      required_rung: null,
      routing_decision: "continue_chat",
      task_form: taskForm === "unknown" ? "teach" : taskForm,
    } as const;

    return {
      analysisMode: raw.analysis_mode,
      confidence: raw.confidence,
      guardrailFlag: raw.guardrail_flag,
      proposedFocusLabel: suggestedLabels.proposedFocusLabel,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      requiredRung: raw.required_rung,
      routingDecision: raw.routing_decision,
      taskForm: raw.task_form,
    };
  }

  const requiredRung = inferRequiredRung(normalized);

  if (guardrail.flag !== "none") {
    const raw = {
      analysis_mode: "dataset_backed_analysis",
      confidence: 0.89,
      guardrail_flag: guardrail.flag,
      reason:
        guardrail.flag === "unsupported_direct_mechanism"
          ? "The request starts from observational evidence but presupposes a direct mechanism that is not yet identified."
          : guardrail.flag === "unsupported_actual_cause_presupposition"
            ? "The request presupposes an actual-cause or but-for conclusion without the counterfactual setup needed to support it."
            : "The request tries to jump from observational evidence to a higher-rung intervention claim without the setup needed to justify that jump.",
      required_rung:
        guardrail.flag === "unsupported_actual_cause_presupposition"
          ? "rung_3_counterfactual"
          : "rung_1_observational",
      routing_decision: "ask_clarification",
      task_form: taskForm === "unknown" ? "explain" : taskForm,
    } as const;

    return {
      analysisMode: raw.analysis_mode,
      confidence: raw.confidence,
      guardrailFlag: raw.guardrail_flag,
      proposedFocusLabel: suggestedLabels.proposedFocusLabel,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      requiredRung: raw.required_rung,
      routingDecision: raw.routing_decision,
      taskForm: raw.task_form,
    };
  }

  if (requiredRung === "rung_3_counterfactual") {
    const raw = {
      analysis_mode: "dataset_backed_analysis",
      confidence: 0.95,
      guardrail_flag: "none",
      reason: "The request asks a but-for, actual-cause, or counterfactual question.",
      required_rung: requiredRung,
      routing_decision: "open_rung3_study",
      task_form: taskForm === "unknown" ? "explain" : taskForm,
    } as const;

    return {
      analysisMode: raw.analysis_mode,
      confidence: raw.confidence,
      guardrailFlag: raw.guardrail_flag,
      proposedFocusLabel: suggestedLabels.proposedFocusLabel,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      requiredRung: raw.required_rung,
      routingDecision: raw.routing_decision,
      taskForm: raw.task_form,
    };
  }

  if (requiredRung === "rung_2_interventional") {
    const raw = {
      analysis_mode: "dataset_backed_analysis",
      confidence: 0.94,
      guardrail_flag: "none",
      reason: "The request asks about the effect of doing, changing, or choosing something.",
      required_rung: requiredRung,
      routing_decision: "open_rung2_study",
      task_form: taskForm === "unknown" ? "advise" : taskForm,
    } as const;

    return {
      analysisMode: raw.analysis_mode,
      confidence: raw.confidence,
      guardrailFlag: raw.guardrail_flag,
      proposedFocusLabel: suggestedLabels.proposedFocusLabel,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      requiredRung: raw.required_rung,
      routingDecision: raw.routing_decision,
      taskForm: raw.task_form,
    };
  }

  if (requiredRung === "rung_1_observational") {
    const raw = {
      analysis_mode: "dataset_backed_analysis",
      confidence: 0.88,
      guardrail_flag: "none",
      reason: "The request can be answered observationally without claiming an intervention or counterfactual effect.",
      required_rung: requiredRung,
      routing_decision: "open_rung1_analysis",
      task_form: taskForm === "unknown" ? "describe" : taskForm,
    } as const;

    return {
      analysisMode: raw.analysis_mode,
      confidence: raw.confidence,
      guardrailFlag: raw.guardrail_flag,
      proposedFocusLabel: suggestedLabels.proposedFocusLabel,
      proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
      proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
      rawOutputJson: JSON.stringify(raw),
      reason: raw.reason,
      requiredRung: raw.required_rung,
      routingDecision: raw.routing_decision,
      taskForm: raw.task_form,
    };
  }

  const raw = {
    analysis_mode: "dataset_backed_analysis",
    confidence: 0.55,
    guardrail_flag: "none",
    reason: "The request sounds analytical, but the goal is still underspecified enough that the system should clarify before routing.",
    required_rung: null,
    routing_decision: "ask_clarification",
    task_form: taskForm,
  } as const;

  return {
    analysisMode: raw.analysis_mode,
    confidence: raw.confidence,
    guardrailFlag: raw.guardrail_flag,
    proposedFocusLabel: suggestedLabels.proposedFocusLabel,
    proposedOutcomeLabel: suggestedLabels.proposedOutcomeLabel,
    proposedTreatmentLabel: suggestedLabels.proposedTreatmentLabel,
    rawOutputJson: JSON.stringify(raw),
    reason: raw.reason,
    requiredRung: raw.required_rung,
    routingDecision: raw.routing_decision,
    taskForm: raw.task_form,
  };
}

function buildSafeFallbackClassification(): AnalysisRoutingClassification {
  const raw = {
    analysis_mode: "dataset_backed_analysis",
    confidence: 0.4,
    guardrail_flag: "none",
    reason: "The intake classifier could not determine the analytical mode or required rung safely enough to choose a route.",
    required_rung: null,
    routing_decision: "ask_clarification",
    task_form: "unknown",
  } as const;

  return {
    analysisMode: raw.analysis_mode,
    confidence: raw.confidence,
    guardrailFlag: raw.guardrail_flag,
    proposedFocusLabel: null,
    proposedOutcomeLabel: null,
    proposedTreatmentLabel: null,
    rawOutputJson: JSON.stringify(raw),
    reason: raw.reason,
    requiredRung: raw.required_rung,
    routingDecision: raw.routing_decision,
    taskForm: raw.task_form,
  };
}

export async function classifyAnalysisRequest(message: string): Promise<AnalysisRoutingClassification> {
  const firstPass = buildHeuristicClassification(message);
  const parsed = parseAnalysisClassifierOutput(firstPass.rawOutputJson);

  if (parsed) {
    return {
      analysisMode: parsed.analysis_mode,
      confidence: parsed.confidence,
      guardrailFlag: parsed.guardrail_flag ?? firstPass.guardrailFlag,
      proposedFocusLabel: firstPass.proposedFocusLabel ?? null,
      proposedOutcomeLabel: firstPass.proposedOutcomeLabel ?? null,
      proposedTreatmentLabel: firstPass.proposedTreatmentLabel ?? null,
      rawOutputJson: firstPass.rawOutputJson,
      reason: parsed.reason,
      requiredRung:
        parsed.required_rung === undefined ? firstPass.requiredRung : parsed.required_rung ?? null,
      routingDecision: (parsed.routing_decision ?? firstPass.routingDecision) as RoutingDecision,
      taskForm: (parsed.task_form ?? firstPass.taskForm) as TaskForm,
    };
  }

  return buildSafeFallbackClassification();
}

export function getAnalysisRouterMetadata() {
  return {
    chatFallbackPath: RUNG1_FALLBACK_PATH,
    modelName: ANALYSIS_ROUTER_MODEL_NAME,
    promptVersion: ANALYSIS_ROUTER_PROMPT_VERSION,
    rung1FallbackPath: RUNG1_FALLBACK_PATH,
  };
}
