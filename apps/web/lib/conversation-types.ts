import type { SessionData, SessionMetadata } from "@mariozechner/pi-web-ui";

export const CONVERSATION_VISIBILITIES = ["private", "organization"] as const;

export type ConversationVisibility = (typeof CONVERSATION_VISIBILITIES)[number];

export type ConversationSessionData = SessionData;
export type ConversationMetadata = SessionMetadata & {
  canManage: boolean;
  isPinned: boolean;
  visibility: ConversationVisibility;
};

export type ListConversationsResponse = {
  conversations: ConversationMetadata[];
};

export type GetConversationResponse = {
  conversation: ConversationSessionData;
  metadata: ConversationMetadata;
};

export type UpsertConversationResponse = {
  conversationId: string;
  metadata: ConversationMetadata;
};

export type UpdateConversationResponse = {
  metadata: ConversationMetadata;
};

export type DeleteConversationResponse = {
  conversationId: string;
};
