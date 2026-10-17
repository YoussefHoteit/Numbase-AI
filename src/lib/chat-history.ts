import type { ModelMessage } from "ai";
import type { ChatMessage } from "./chat-schema.ts";

export function snapshotTextMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.flatMap((part) => part.type === "text" ? [{ type: "text" as const, text: part.text }] : []),
    ...(message.metadata ? { metadata: { ...message.metadata } } : {}),
  })).filter((message) => message.parts.length > 0);
}

export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  return snapshotTextMessages(messages).map((message) => ({
    role: message.role,
    content: message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n"),
  }));
}
