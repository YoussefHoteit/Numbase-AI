import { DefaultChatTransport } from "ai";
import type { ChatMessage } from "./chat-schema.ts";
import { snapshotTextMessages } from "./chat-history.ts";

export function createChatTransport(
  options: { fetch?: typeof globalThis.fetch } = {},
) {
  return new DefaultChatTransport<ChatMessage>({
    api: "/api/chat",
    ...options,
    prepareSendMessagesRequest: ({ messages, body, id }) => ({
      // Resend the full chat for each turn, including replies from other models.
      body: { ...body, id, messages: snapshotTextMessages(messages) },
    }),
  });
}
