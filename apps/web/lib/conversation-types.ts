import type { SessionData, SessionMetadata } from "@mariozechner/pi-web-ui";

export type ConversationSessionData = SessionData;
export type ConversationMetadata = SessionMetadata;

export type ListConversationsResponse = {
  conversations: ConversationMetadata[];
};

export type GetConversationResponse = {
  conversation: ConversationSessionData;
};

export type UpsertConversationResponse = {
  conversationId: string;
  metadata: ConversationMetadata;
};
