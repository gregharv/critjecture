import "server-only";

import { complete, getModel } from "@mariozechner/pi-ai";

import type { ClarificationIntent } from "@/lib/analytical-clarification";
import { DEFAULT_CHAT_MODEL_ID } from "@/lib/chat-models";

const CLARIFICATION_WORDING_TIMEOUT_MS = 2_500;
const CLARIFICATION_WORDING_MAX_TOKENS = 220;

export type ClarificationWording = {
  eyebrow?: string | null;
  lead?: string | null;
  question: string;
};

function isClarificationWordingEnabled() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const direct = (() => {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  })();

  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseClarificationWording(text: string): ClarificationWording | null {
  const parsed = extractJsonObject(text);

  if (!parsed) {
    return null;
  }

  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";

  if (!question) {
    return null;
  }

  const eyebrow = typeof parsed.eyebrow === "string" ? parsed.eyebrow.trim() : "";
  const lead = typeof parsed.lead === "string" ? parsed.lead.trim() : "";

  return {
    eyebrow: eyebrow || null,
    lead: lead || null,
    question,
  };
}

function buildClarificationPrompt(intent: ClarificationIntent) {
  return JSON.stringify(
    {
      clarificationKind: intent.clarificationKind,
      epistemicPosture: intent.epistemicPosture,
      goal: intent.goal,
      hasData: intent.hasData,
      inferredGrouping: intent.grouping,
      inferredMetric: intent.metric,
      inferredTimeWindow: intent.timeWindow,
      loadedQuestionFraming: intent.loadedQuestionFraming,
      message: intent.message,
      previousPosture: intent.previousPosture ?? null,
      routingReason: intent.classification.reason,
    },
    null,
    2,
  );
}

export async function generateClarificationWording(
  intent: ClarificationIntent,
): Promise<ClarificationWording | null> {
  if (!isClarificationWordingEnabled()) {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  try {
    const model = getModel("openai", DEFAULT_CHAT_MODEL_ID);
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, CLARIFICATION_WORDING_TIMEOUT_MS);

    const response = await complete(
      model,
      {
        systemPrompt: [
          "You write one conversational clarification question for an analytical assistant.",
          "You are only wording the clarification, not deciding whether clarification is needed.",
          "Use the structured input exactly as constraints.",
          "Do not ask for information the user already provided.",
          "Ask exactly one clarification question.",
          "If the posture is guardrail or the clarificationKind is loaded_presupposition_reframe, do not accept the user's causal framing as established fact.",
          "Write like a polished customer-facing assistant, not an internal template.",
          "Use the user's context naturally so the question feels specific to their request.",
          "Keep the wording natural, concise, and non-templated.",
          "Return strict JSON only with keys eyebrow, lead, question.",
          "The question field is required. eyebrow and lead are optional and should be subtle if present.",
          "Do not include markdown fences or explanations.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              "Structured clarification intent:",
              buildClarificationPrompt(intent),
              "Return JSON only.",
            ].join("\n\n"),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        maxTokens: CLARIFICATION_WORDING_MAX_TOKENS,
        reasoning: "minimal",
        signal: abortController.signal,
        temperature: 0.2,
      },
    ).finally(() => {
      clearTimeout(timeoutHandle);
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return parseClarificationWording(text);
  } catch {
    return null;
  }
}
