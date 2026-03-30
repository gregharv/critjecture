import { getModel, stream } from "@mariozechner/pi-ai";

import { getSessionUser } from "@/lib/auth-state";
import {
  DEFAULT_CHAT_MODEL_ID,
  OPENAI_MODEL_IDS,
  type OpenAiModelId,
} from "@/lib/chat-models";
import {
  attachRequestId,
  beginObservedRequest,
  buildBudgetExceededResponse,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  clampChatMaxTokens,
  enforceBudgetPolicy,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

type ProxyRequestBody = {
  context?: {
    messages?: unknown[];
    systemPrompt?: string;
    tools?: unknown[];
  };
  options?: {
    temperature?: number;
    maxTokens?: number;
    reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  };
};

type ProxyEvent =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; contentSignature?: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; contentSignature?: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; usage: unknown }
  | {
      type: "error";
      reason: "aborted" | "error";
      errorMessage?: string;
      usage: unknown;
    };

function encodeEvent(event: ProxyEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isOpenAiModelId(value: string): value is OpenAiModelId {
  return OPENAI_MODEL_IDS.includes(value as OpenAiModelId);
}

function getUsageNumber(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return 0;
  }

  const nextValue = value[key as keyof typeof value];

  return typeof nextValue === "number" ? nextValue : 0;
}

function normalizeUsage(value: unknown) {
  const cost =
    typeof value === "object" && value !== null && "cost" in value && typeof value.cost === "object"
      ? value.cost
      : null;

  return {
    costUsd: roundCost(getUsageNumber(cost, "total")),
    inputTokens: getUsageNumber(value, "input"),
    outputTokens: getUsageNumber(value, "output"),
    totalTokens: getUsageNumber(value, "totalTokens"),
  };
}

function roundCost(value: number) {
  return Number(value.toFixed(6));
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const routeKey = "chat.stream";
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "chat",
    routeKey,
    user,
  });
  await runOperationsMaintenance();

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  const budgetDecision = await enforceBudgetPolicy({
    requestId: observed.requestId,
    routeGroup: "chat",
    routeKey,
    user,
  });

  if (budgetDecision) {
    return finalizeObservedRequest(observed, {
      errorCode: budgetDecision.errorCode,
      metadata: budgetDecision.metadata,
      outcome: "blocked",
      response: buildBudgetExceededResponse(budgetDecision),
    });
  }

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "chat",
    user,
  });

  if (rateLimitDecision) {
    return finalizeObservedRequest(observed, {
      errorCode: rateLimitDecision.errorCode,
      metadata: {
        limit: rateLimitDecision.limit,
        scope: rateLimitDecision.scope,
        windowMs: rateLimitDecision.windowMs,
      },
      outcome: "rate_limited",
      response: buildRateLimitedResponse(rateLimitDecision),
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return finalizeObservedRequest(observed, {
      errorCode: "missing_openai_api_key",
      outcome: "error",
      response: buildObservedErrorResponse(
        "Missing OPENAI_API_KEY. Add it to apps/web/.env.local before testing live chat.",
        500,
      ),
    });
  }

  let body: ProxyRequestBody;

  try {
    body = (await request.json()) as ProxyRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  if (!body.context || !Array.isArray(body.context.messages)) {
    return finalizeObservedRequest(observed, {
      errorCode: "missing_messages",
      outcome: "error",
      response: buildObservedErrorResponse(
        "Request body must include a valid context.messages array.",
        400,
      ),
    });
  }

  const context = body.context;
  const requestedModelId = process.env.OPENAI_MODEL ?? DEFAULT_CHAT_MODEL_ID;

  if (!isOpenAiModelId(requestedModelId)) {
    return finalizeObservedRequest(observed, {
      errorCode: "unsupported_model",
      outcome: "error",
      response: buildObservedErrorResponse(
        `Unsupported OPENAI_MODEL "${requestedModelId}". Supported model: ${OPENAI_MODEL_IDS.join(", ")}.`,
        500,
      ),
    });
  }

  let model;

  try {
    model = getModel("openai", requestedModelId);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : `Unsupported OpenAI model: ${requestedModelId}`;

    return finalizeObservedRequest(observed, {
      errorCode: "model_initialization_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
    });
  }

  const encoder = new TextEncoder();
  const maxTokens = clampChatMaxTokens(body.options?.maxTokens);

  const responseStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: ProxyEvent) => {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      void (async () => {
        let finalStatusCode = 200;
        let finalErrorCode: string | null = null;
        let finalOutcome: "ok" | "error" = "ok";
        let finalUsage: ReturnType<typeof normalizeUsage> = {
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };

        try {
          const completionStream = stream(
            model,
            {
              systemPrompt: body.context?.systemPrompt,
              messages: context.messages as never[],
              tools: context.tools as never[] | undefined,
            },
            {
              apiKey,
              signal: request.signal,
              maxTokens,
              reasoning: body.options?.reasoning,
              temperature: body.options?.temperature,
            },
          );

          for await (const event of completionStream) {
            switch (event.type) {
              case "start":
                push({ type: "start" });
                break;
              case "text_start":
                push({ type: "text_start", contentIndex: event.contentIndex });
                break;
              case "text_delta":
                push({
                  type: "text_delta",
                  contentIndex: event.contentIndex,
                  delta: event.delta,
                });
                break;
              case "text_end": {
                const content = event.partial.content[event.contentIndex];
                push({
                  type: "text_end",
                  contentIndex: event.contentIndex,
                  contentSignature:
                    content?.type === "text" ? content.textSignature : undefined,
                });
                break;
              }
              case "thinking_start":
                push({ type: "thinking_start", contentIndex: event.contentIndex });
                break;
              case "thinking_delta":
                push({
                  type: "thinking_delta",
                  contentIndex: event.contentIndex,
                  delta: event.delta,
                });
                break;
              case "thinking_end": {
                const content = event.partial.content[event.contentIndex];
                push({
                  type: "thinking_end",
                  contentIndex: event.contentIndex,
                  contentSignature:
                    content?.type === "thinking"
                      ? content.thinkingSignature
                      : undefined,
                });
                break;
              }
              case "toolcall_start": {
                const toolCall = event.partial.content[event.contentIndex];

                if (toolCall?.type === "toolCall") {
                  push({
                    type: "toolcall_start",
                    contentIndex: event.contentIndex,
                    id: toolCall.id,
                    toolName: toolCall.name,
                  });
                }
                break;
              }
              case "toolcall_delta":
                push({
                  type: "toolcall_delta",
                  contentIndex: event.contentIndex,
                  delta: event.delta,
                });
                break;
              case "toolcall_end":
                push({ type: "toolcall_end", contentIndex: event.contentIndex });
                break;
              case "done":
                finalUsage = normalizeUsage(event.message.usage);
                push({
                  type: "done",
                  reason: event.reason,
                  usage: event.message.usage,
                });
                break;
              case "error":
                finalOutcome = "error";
                finalStatusCode = 500;
                finalErrorCode =
                  event.reason === "aborted" ? "stream_aborted" : "provider_stream_error";
                finalUsage = normalizeUsage(event.error.usage);
                push({
                  type: "error",
                  reason: event.reason,
                  errorMessage: event.error.errorMessage,
                  usage: event.error.usage,
                });
                break;
            }
          }
        } catch (caughtError) {
          const errorMessage =
            caughtError instanceof Error ? caughtError.message : "Proxy stream failed.";
          finalOutcome = "error";
          finalStatusCode = request.signal.aborted ? 499 : 500;
          finalErrorCode = request.signal.aborted ? "stream_aborted" : "provider_stream_failed";

          push({
            type: "error",
            reason: request.signal.aborted ? "aborted" : "error",
            errorMessage,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          });
        } finally {
          await finalizeObservedRequest(observed, {
            errorCode: finalErrorCode,
            metadata: {
              clampedMaxTokens: maxTokens ?? null,
              requestedMaxTokens:
                typeof body.options?.maxTokens === "number" ? body.options.maxTokens : null,
              streamResponseStatus: 200,
            },
            modelName: requestedModelId,
            outcome: finalOutcome,
            response: new Response(null, { status: finalStatusCode }),
            totalCostUsd: finalUsage.costUsd,
            totalTokens: finalUsage.totalTokens,
            usageEvents: [
              {
                costUsd: finalUsage.costUsd,
                eventType: "model_completion",
                inputTokens: finalUsage.inputTokens,
                metadata: {
                  completionStatus: finalOutcome,
                  reasoning: body.options?.reasoning ?? null,
                },
                outputTokens: finalUsage.outputTokens,
                status: finalOutcome === "ok" ? "completed" : "error",
                subjectName: requestedModelId,
                totalTokens: finalUsage.totalTokens,
              },
            ],
          });
          controller.close();
        }
      })();
    },
  });

  return attachRequestId(new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  }), observed.requestId);
}
