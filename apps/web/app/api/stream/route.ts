import { getModel, stream } from "@mariozechner/pi-ai";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";

export const runtime = "nodejs";

const OPENAI_MODEL_IDS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1",
] as const;

type OpenAiModelId = (typeof OPENAI_MODEL_IDS)[number];

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

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function encodeEvent(event: ProxyEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isOpenAiModelId(value: string): value is OpenAiModelId {
  return OPENAI_MODEL_IDS.includes(value as OpenAiModelId);
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return jsonError(
      "Missing OPENAI_API_KEY. Add it to apps/web/.env.local before testing live chat.",
      500,
    );
  }

  let body: ProxyRequestBody;

  try {
    body = (await request.json()) as ProxyRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  if (!body.context || !Array.isArray(body.context.messages)) {
    return jsonError("Request body must include a valid context.messages array.", 400);
  }

  const context = body.context;
  const requestedModelId = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!isOpenAiModelId(requestedModelId)) {
    return jsonError(
      `Unsupported OPENAI_MODEL "${requestedModelId}". Supported Step 1 models: ${OPENAI_MODEL_IDS.join(", ")}.`,
      500,
    );
  }

  let model;

  try {
    model = getModel("openai", requestedModelId);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : `Unsupported OpenAI model: ${requestedModelId}`;

    return jsonError(message, 500);
  }

  const encoder = new TextEncoder();

  const responseStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: ProxyEvent) => {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      void (async () => {
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
              maxTokens: body.options?.maxTokens,
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
                push({
                  type: "done",
                  reason: event.reason,
                  usage: event.message.usage,
                });
                break;
              case "error":
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
          controller.close();
        }
      })();
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
