import "server-only";

import { classifyAnalysisRequest } from "@/lib/analysis-router";
import {
  CHAT_FALLBACK_PATH,
  type AnalysisIntakeResponse,
  type AnalysisRoutingClassification,
  type AskClarificationIntakeResponse,
  type BlockedIntakeResponse,
  type ClarificationKind,
  type ContinueChatIntakeResponse,
  type EpistemicPosture,
  type OpenRung1AnalysisIntakeResponse,
  type OpenRung2StudyIntakeResponse,
  type OpenRung3StudyIntakeResponse,
  RUNG1_FALLBACK_PATH,
} from "@/lib/analysis-routing-types";
import { ensureAnalysisFoundationForUser } from "@/lib/analysis-foundation-sync";
import { toCompatibilityAnalysisQuestionType } from "@/lib/analysis-intent-compatibility";
import { buildGuardrailClarification } from "@/lib/analysis-presupposition-guardrail";
import {
  createAnalysisStudyQuestion,
  ensureResumableAnalysisStudy,
  recordAnalysisClassification,
} from "@/lib/analysis-studies";
import type { AuthenticatedAppUser } from "@/lib/users";

function buildClarificationState(classification: AnalysisRoutingClassification): {
  clarificationKind: ClarificationKind;
  epistemicPosture: EpistemicPosture;
} {
  if (classification.guardrailFlag !== "none") {
    const guardrail = buildGuardrailClarification({
      flag: classification.guardrailFlag,
      latestMessage: classification.rawOutputJson,
    });

    return {
      clarificationKind: guardrail.clarificationKind,
      epistemicPosture: guardrail.epistemicPosture,
    };
  }

  if (classification.requiredRung === "rung_2_interventional") {
    return {
      clarificationKind: "rung_1_vs_rung_2",
      epistemicPosture: "interventional",
    };
  }

  if (classification.requiredRung === "rung_3_counterfactual") {
    return {
      clarificationKind: "rung_1_vs_rung_3",
      epistemicPosture: "counterfactual",
    };
  }

  return {
    clarificationKind: "goal_disambiguation",
    epistemicPosture:
      classification.analysisMode === "ordinary_chat" ? "ordinary_chat" : "observational",
  };
}

function buildClarificationQuestion(classification: AnalysisRoutingClassification) {
  if (classification.guardrailFlag !== "none") {
    return buildGuardrailClarification({
      flag: classification.guardrailFlag,
      latestMessage: classification.reason,
    }).question;
  }

  if (classification.requiredRung === "rung_2_interventional") {
    return "Do you want an observational read on what is associated with the outcome, or do you want to open an intervention study about what would happen if you changed something?";
  }

  if (classification.requiredRung === "rung_3_counterfactual") {
    return "Do you want an observational explanation of what was happening, or do you want to frame this as a counterfactual question about what would have happened under a different action or state?";
  }

  return "Do you want ordinary conceptual guidance, or are you asking for dataset-backed analysis?";
}

export async function runAnalysisIntake(input: {
  clarificationState?: {
    clarificationKind?: ClarificationKind | null;
    epistemicPosture?: EpistemicPosture | null;
  } | null;
  message: string;
  requestedStudyId?: string | null;
  user: AuthenticatedAppUser;
}): Promise<AnalysisIntakeResponse> {
  const message = input.message.trim();
  const classification = await classifyAnalysisRequest(message);

  if (classification.routingDecision === "continue_chat") {
    const response: ContinueChatIntakeResponse = {
      classification: {
        analysis_mode: "ordinary_chat",
        confidence: classification.confidence,
        guardrail_flag: classification.guardrailFlag,
        reason: classification.reason,
        required_rung: null,
        task_form: classification.taskForm,
      },
      decision: "continue_chat",
      nextPath: CHAT_FALLBACK_PATH,
    };

    return response;
  }

  if (classification.routingDecision === "open_rung1_analysis") {
    const response: OpenRung1AnalysisIntakeResponse = {
      classification: {
        analysis_mode: "dataset_backed_analysis",
        confidence: classification.confidence,
        guardrail_flag: classification.guardrailFlag,
        reason: classification.reason,
        required_rung: "rung_1_observational",
        task_form: classification.taskForm,
      },
      decision: "open_rung1_analysis",
      nextPath: RUNG1_FALLBACK_PATH,
    };

    return response;
  }

  if (classification.routingDecision === "ask_clarification") {
    const clarificationState = buildClarificationState(classification);
    const response: AskClarificationIntakeResponse = {
      classification: {
        analysis_mode: classification.analysisMode,
        confidence: classification.confidence,
        guardrail_flag: classification.guardrailFlag,
        reason: classification.reason,
        required_rung: classification.requiredRung,
        task_form: classification.taskForm,
      },
      clarificationState,
      decision: "ask_clarification",
      question: buildClarificationQuestion(classification),
    };

    return response;
  }

  if (classification.routingDecision === "blocked") {
    const response: BlockedIntakeResponse = {
      classification: {
        analysis_mode: classification.analysisMode,
        confidence: classification.confidence,
        guardrail_flag: classification.guardrailFlag,
        reason: classification.reason,
        required_rung: classification.requiredRung,
        task_form: classification.taskForm,
      },
      decision: "blocked",
      message: "Analysis intake is currently blocked for this request.",
    };

    return response;
  }

  await ensureAnalysisFoundationForUser(input.user);

  const study = await ensureResumableAnalysisStudy({
    createdByUserId: input.user.id,
    organizationId: input.user.organizationId,
    questionText: message,
    requestedStudyId: input.requestedStudyId,
  });

  const question = await createAnalysisStudyQuestion({
    askedByUserId: input.user.id,
    organizationId: input.user.organizationId,
    proposedOutcomeLabel: classification.proposedOutcomeLabel ?? classification.proposedFocusLabel ?? null,
    proposedTreatmentLabel: classification.proposedTreatmentLabel ?? null,
    questionText: message,
    questionType: toCompatibilityAnalysisQuestionType(classification),
    studyId: study.id,
  });

  await recordAnalysisClassification({
    classification,
    organizationId: input.user.organizationId,
    studyQuestionId: question.id,
  });

  if (classification.routingDecision === "open_rung3_study") {
    const response: OpenRung3StudyIntakeResponse = {
      classification: {
        analysis_mode: "dataset_backed_analysis",
        confidence: classification.confidence,
        guardrail_flag: classification.guardrailFlag,
        reason: classification.reason,
        required_rung: "rung_3_counterfactual",
        task_form: classification.taskForm,
      },
      decision: "open_rung3_study",
      proposedFocusLabel: classification.proposedFocusLabel ?? null,
      proposedOutcomeLabel: classification.proposedOutcomeLabel ?? null,
      proposedTreatmentLabel: classification.proposedTreatmentLabel ?? null,
      studyId: study.id,
      studyQuestionId: question.id,
      suggestedDatasetIds: [],
    };

    return response;
  }

  const response: OpenRung2StudyIntakeResponse = {
    classification: {
      analysis_mode: "dataset_backed_analysis",
      confidence: classification.confidence,
      guardrail_flag: classification.guardrailFlag,
      reason: classification.reason,
      required_rung: "rung_2_interventional",
      task_form: classification.taskForm,
    },
    decision: "open_rung2_study",
    proposedFocusLabel: classification.proposedFocusLabel ?? null,
    proposedOutcomeLabel: classification.proposedOutcomeLabel ?? null,
    proposedTreatmentLabel: classification.proposedTreatmentLabel ?? null,
    studyId: study.id,
    studyQuestionId: question.id,
    suggestedDatasetIds: [],
  };

  return response;
}
