import type { ModelMessage } from "ai";
import type { ChatMessage } from "./chat-schema.ts";
import { assetIdFromUrl, imageResultSchema } from "./media.ts";

export function snapshotTextMessages(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  // The SDK can mutate streaming parts. Stored history must own its text objects.
  return messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts.filter((part) =>
        part.type === "text" ||
        (part.type === "file" && !!assetIdFromUrl(part.url)) ||
        part.type === "tool-createImage",
      ).map((part) => {
        if (part.type === "text") return { type: "text" as const, text: part.text };
        if (part.type === "file") return { type: "file" as const, url: part.url, mediaType: part.mediaType, ...(part.filename ? { filename: part.filename } : {}) };
        return JSON.parse(JSON.stringify(part)) as typeof part;
      }),
      ...(message.metadata ? { metadata: { ...message.metadata } } : {}),
    }))
    .filter((message) => message.parts.length > 0);
}

export const snapshotMessages = snapshotTextMessages;

export function imageIds(messages: readonly ChatMessage[]): string[] {
  return [...new Set(messages.flatMap((message) => message.parts.flatMap((part) => {
    if (part.type === "file") return assetIdFromUrl(part.url) ?? [];
    if (part.type === "tool-createImage" && part.state === "output-available") {
      const result = imageResultSchema.safeParse(part.output);
      return result.success ? [result.data.assetId] : [];
    }
    return [];
  })))];
}

export function toModelMessages(
  messages: readonly ChatMessage[],
): ModelMessage[] {
  // Model labels stay in the UI; every provider receives the same roles and text.
  return snapshotTextMessages(messages).map((message) => ({
    role: message.role,
    content: message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n"),
  }));
}
