import "server-only";

import { classifyCausalIntent } from "@/lib/causal-intent";
import {
  type AskClarificationIntakeResponse,
  type CausalIntakeResponse,
  type ContinueDescriptiveIntakeResponse,
  DESCRIPTIVE_FALLBACK_PATH,
  type EpistemicPosture,
  type OpenCausalStudyIntakeResponse,
  type OpenPredictiveAnalysisIntakeResponse,
  PREDICTIVE_FALLBACK_PATH,
} from "@/lib/causal-intent-types";
import { buildConversationalClarificationQuestion } from "@/lib/analytical-clarification";
import { ensureCausalFoundationForUser } from "@/lib/causal-foundation-sync";
import {
  createStudyQuestion,
  ensureResumableCausalStudy,
  recordIntentClassification,
} from "@/lib/causal-studies";
import type { AuthenticatedAppUser } from "@/lib/users";

export async function runCausalIntake(input: {
  clarificationState?: {
    epistemicPosture?: EpistemicPosture | null;
  } | null;
  message: string;
  requestedStudyId?: string | null;
  user: AuthenticatedAppUser;
}): Promise<CausalIntakeResponse> {
  const message = input.message.trim();
  const classification = await classifyCausalIntent(message);
  if (classification.routingDecision === "continue_descriptive") {
    const response: ContinueDescriptiveIntakeResponse = {
      decision: "continue_descriptive",
      intent: {
        confidence: classification.confidence,
        intent_type: classification.intentType,
        is_causal: false,
        reason: classification.reason,
      },
      nextPath: DESCRIPTIVE_FALLBACK_PATH,
    };

    return response;
  }

  if (classification.routingDecision === "open_predictive_analysis") {
    const response: OpenPredictiveAnalysisIntakeResponse = {
      decision: "open_predictive_analysis",
      intent: {
        confidence: classification.confidence,
        intent_type:
          classification.intentType === "associational" ? "associational" : "predictive",
        is_causal: false,
        reason: classification.reason,
      },
      nextPath: PREDICTIVE_FALLBACK_PATH,
    };

    return response;
  }

  if (classification.routingDecision === "ask_clarification") {
    const clarification = buildConversationalClarificationQuestion(
      message,
      classification,
      input.clarificationState?.epistemicPosture ?? null,
    );
    const response: AskClarificationIntakeResponse = {
      clarificationState: {
        epistemicPosture: clarification.epistemicPosture,
      },
      decision: "ask_clarification",
      intent: {
        confidence: classification.confidence,
        intent_type: "unclear",
        is_causal: false,
        reason: classification.reason,
      },
      question: clarification.question,
    };

    return response;
  }

  if (classification.routingDecision === "blocked") {
    return {
      decision: "blocked",
      intent: {
        confidence: classification.confidence,
        intent_type: classification.intentType,
        is_causal: classification.isCausal,
        reason: classification.reason,
      },
      message: "Causal intake is currently blocked for this request.",
    };
  }

  await ensureCausalFoundationForUser(input.user);

  const study = await ensureResumableCausalStudy({
    createdByUserId: input.user.id,
    organizationId: input.user.organizationId,
    questionText: message,
    requestedStudyId: input.requestedStudyId,
  });

  const question = await createStudyQuestion({
    askedByUserId: input.user.id,
    organizationId: input.user.organizationId,
    proposedOutcomeLabel: classification.proposedOutcomeLabel ?? null,
    proposedTreatmentLabel: classification.proposedTreatmentLabel ?? null,
    questionText: message,
    questionType: classification.questionType,
    studyId: study.id,
  });

  await recordIntentClassification({
    classification,
    organizationId: input.user.organizationId,
    studyQuestionId: question.id,
  });

  const response: OpenCausalStudyIntakeResponse = {
    decision: "open_causal_study",
    intent: {
      confidence: classification.confidence,
      intent_type: classification.intentType,
      is_causal: true,
      reason: classification.reason,
    },
    proposedOutcomeLabel: classification.proposedOutcomeLabel ?? null,
    proposedTreatmentLabel: classification.proposedTreatmentLabel ?? null,
    questionType: classification.questionType,
    studyId: study.id,
    studyQuestionId: question.id,
    suggestedDatasetIds: [],
  };

  return response;
}
