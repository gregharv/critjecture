export const DEFAULT_CHAT_MODEL_ID = "gpt-5.4-mini";
export const DATA_ANALYSIS_CHAT_MODEL_ID = "gpt-5.3-codex";
export const DEFAULT_CHAT_THINKING_LEVEL = "low";

export const OPENAI_MODEL_IDS = [
  DEFAULT_CHAT_MODEL_ID,
  DATA_ANALYSIS_CHAT_MODEL_ID,
] as const;

export type OpenAiModelId = (typeof OPENAI_MODEL_IDS)[number];

export function getSessionModelId(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.trim()
  ) {
    return value.id.trim();
  }

  return null;
}
