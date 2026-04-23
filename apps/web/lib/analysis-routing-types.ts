export const ANALYSIS_ROUTER_MODEL_NAME = "heuristic-analysis-router-v1";
export const ANALYSIS_ROUTER_PROMPT_VERSION = "rung-first-routing-v1";
export const CHAT_FALLBACK_PATH = "/chat";
export const RUNG1_FALLBACK_PATH = "/analysis/observational";

export const ANALYSIS_MODES = ["ordinary_chat", "dataset_backed_analysis"] as const;
export const REQUIRED_RUNGS = [
  "rung_1_observational",
  "rung_2_interventional",
  "rung_3_counterfactual",
] as const;
export const TASK_FORMS = [
  "describe",
  "predict",
  "explain",
  "advise",
  "compare",
  "teach",
  "critique",
  "unknown",
] as const;
export const GUARDRAIL_FLAGS = [
  "none",
  "unsupported_rung_jump",
  "unsupported_direct_mechanism",
  "unsupported_actual_cause_presupposition",
] as const;
export const ROUTING_DECISIONS = [
  "continue_chat",
  "open_rung1_analysis",
  "open_rung2_study",
  "open_rung3_study",
  "ask_clarification",
  "blocked",
] as const;
export const CLARIFICATION_KINDS = [
  "goal_disambiguation",
  "dataset_scope_needed",
  "rung_1_vs_rung_2",
  "rung_1_vs_rung_3",
  "presupposition_reframe",
  "next_detail",
] as const;
export const EPISTEMIC_POSTURES = [
  "ordinary_chat",
  "observational",
  "interventional",
  "counterfactual",
  "guardrail",
  "data_limited",
] as const;

export type AnalysisMode = (typeof ANALYSIS_MODES)[number];
export type RequiredRung = (typeof REQUIRED_RUNGS)[number];
export type TaskForm = (typeof TASK_FORMS)[number];
export type GuardrailFlag = (typeof GUARDRAIL_FLAGS)[number];
export type RoutingDecision = (typeof ROUTING_DECISIONS)[number];
export type ClarificationKind = (typeof CLARIFICATION_KINDS)[number];
export type EpistemicPosture = (typeof EPISTEMIC_POSTURES)[number];

export type AnalysisRoutingClassification = {
  analysisMode: AnalysisMode;
  confidence: number;
  guardrailFlag: GuardrailFlag;
  proposedFocusLabel?: string | null;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  rawOutputJson: string;
  reason: string;
  requiredRung: RequiredRung | null;
  routingDecision: RoutingDecision;
  taskForm: TaskForm;
};

export type ParsedAnalysisClassifierOutput = {
  analysis_mode: AnalysisMode;
  confidence: number;
  guardrail_flag?: GuardrailFlag;
  raw_output_json?: string;
  reason: string;
  required_rung?: RequiredRung | null;
  routing_decision?: RoutingDecision;
  task_form?: TaskForm;
};

export type AnalysisIntakeRequest = {
  clarificationState?: {
    clarificationKind?: ClarificationKind | null;
    epistemicPosture?: EpistemicPosture | null;
  } | null;
  message: string;
  studyId?: string | null;
};

export type ContinueChatIntakeResponse = {
  classification: {
    analysis_mode: "ordinary_chat";
    confidence: number;
    guardrail_flag: GuardrailFlag;
    reason: string;
    required_rung: null;
    task_form: TaskForm;
  };
  decision: "continue_chat";
  nextPath: string;
};

export type OpenRung1AnalysisIntakeResponse = {
  classification: {
    analysis_mode: "dataset_backed_analysis";
    confidence: number;
    guardrail_flag: GuardrailFlag;
    reason: string;
    required_rung: "rung_1_observational";
    task_form: TaskForm;
  };
  decision: "open_rung1_analysis";
  nextPath: string;
};

export type OpenRung2StudyIntakeResponse = {
  classification: {
    analysis_mode: "dataset_backed_analysis";
    confidence: number;
    guardrail_flag: GuardrailFlag;
    reason: string;
    required_rung: "rung_2_interventional";
    task_form: TaskForm;
  };
  decision: "open_rung2_study";
  proposedFocusLabel?: string | null;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  studyId: string;
  studyQuestionId: string;
  suggestedDatasetIds: string[];
};

export type OpenRung3StudyIntakeResponse = {
  classification: {
    analysis_mode: "dataset_backed_analysis";
    confidence: number;
    guardrail_flag: GuardrailFlag;
    reason: string;
    required_rung: "rung_3_counterfactual";
    task_form: TaskForm;
  };
  decision: "open_rung3_study";
  proposedFocusLabel?: string | null;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  studyId: string;
  studyQuestionId: string;
  suggestedDatasetIds: string[];
};

export type AskClarificationIntakeResponse = {
  classification: {
    analysis_mode: AnalysisMode;
    confidence: number;
    guardrail_flag: GuardrailFlag;
    reason: string;
    required_rung: RequiredRung | null;
    task_form: TaskForm;
  };
  clarificationState: {
    clarificationKind: ClarificationKind;
    epistemicPosture: EpistemicPosture;
  };
  decision: "ask_clarification";
  question: string;
};

export type BlockedIntakeResponse = {
  classification: {
    analysis_mode: AnalysisMode;
    confidence: number;
    guardrail_flag: GuardrailFlag;
    reason: string;
    required_rung: RequiredRung | null;
    task_form: TaskForm;
  };
  decision: "blocked";
  message: string;
};

export type AnalysisIntakeResponse =
  | ContinueChatIntakeResponse
  | OpenRung1AnalysisIntakeResponse
  | OpenRung2StudyIntakeResponse
  | OpenRung3StudyIntakeResponse
  | AskClarificationIntakeResponse
  | BlockedIntakeResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAnalysisMode(value: unknown): value is AnalysisMode {
  return typeof value === "string" && ANALYSIS_MODES.includes(value as AnalysisMode);
}

export function isRequiredRung(value: unknown): value is RequiredRung {
  return typeof value === "string" && REQUIRED_RUNGS.includes(value as RequiredRung);
}

export function isTaskForm(value: unknown): value is TaskForm {
  return typeof value === "string" && TASK_FORMS.includes(value as TaskForm);
}

export function isGuardrailFlag(value: unknown): value is GuardrailFlag {
  return typeof value === "string" && GUARDRAIL_FLAGS.includes(value as GuardrailFlag);
}

export function isRoutingDecision(value: unknown): value is RoutingDecision {
  return typeof value === "string" && ROUTING_DECISIONS.includes(value as RoutingDecision);
}

export function isEpistemicPosture(value: unknown): value is EpistemicPosture {
  return typeof value === "string" && EPISTEMIC_POSTURES.includes(value as EpistemicPosture);
}

export function isClarificationKind(value: unknown): value is ClarificationKind {
  return typeof value === "string" && CLARIFICATION_KINDS.includes(value as ClarificationKind);
}

export function clampConfidence(value: unknown, fallback = 0.5) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

export function parseAnalysisIntakeRequest(input: unknown): AnalysisIntakeRequest | null {
  if (!isRecord(input) || typeof input.message !== "string") {
    return null;
  }

  const message = input.message.trim();

  if (!message) {
    return null;
  }

  const studyId =
    typeof input.studyId === "string" && input.studyId.trim() ? input.studyId.trim() : null;

  const clarificationState =
    isRecord(input.clarificationState) &&
    isEpistemicPosture(input.clarificationState.epistemicPosture) &&
    (input.clarificationState.clarificationKind == null ||
      isClarificationKind(input.clarificationState.clarificationKind))
      ? {
          clarificationKind: input.clarificationState.clarificationKind ?? null,
          epistemicPosture: input.clarificationState.epistemicPosture,
        }
      : null;

  return {
    clarificationState,
    message,
    studyId,
  };
}

export function parseAnalysisClassifierOutput(input: unknown): ParsedAnalysisClassifierOutput | null {
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

  if (!isAnalysisMode(parsed.analysis_mode) || typeof parsed.reason !== "string") {
    return null;
  }

  const result: ParsedAnalysisClassifierOutput = {
    analysis_mode: parsed.analysis_mode,
    confidence: clampConfidence(parsed.confidence, 0.5),
    reason: parsed.reason.trim(),
  };

  if (parsed.required_rung == null) {
    result.required_rung = null;
  } else if (isRequiredRung(parsed.required_rung)) {
    result.required_rung = parsed.required_rung;
  }

  if (isTaskForm(parsed.task_form)) {
    result.task_form = parsed.task_form;
  }

  if (isGuardrailFlag(parsed.guardrail_flag)) {
    result.guardrail_flag = parsed.guardrail_flag;
  }

  if (typeof parsed.raw_output_json === "string") {
    result.raw_output_json = parsed.raw_output_json;
  }

  if (isRoutingDecision(parsed.routing_decision)) {
    result.routing_decision = parsed.routing_decision;
  }

  return result;
}
