import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
} from "ai";
import type { ChatMessage } from "../chat-schema.ts";
import { toModelMessages } from "../chat-history.ts";
import type { ModelId } from "../models.ts";
import { modelErrorMessage } from "./model-errors.ts";

const INSTRUCTIONS = [
  "You are Numbase AI, a thoughtful, helpful assistant. Use clear Markdown when useful. Be honest about uncertainty.",
  "All supplied user and assistant messages belong to this same conversation, even when earlier replies came from another model.",
  "Use the supplied conversation history to answer follow-up questions and recall details stated earlier in it.",
  "Distinguish this provided context from persistent memory across separate chats: do not claim that earlier messages are inaccessible when they are present here.",
  "If a requested detail is absent from the supplied messages, say so; never invent remembered information.",
].join(" ");

export function streamOpenRouterResponse({
  model,
  messages,
  signal,
  apiKey,
  fetch,
}: {
  model: ModelId;
  messages: ChatMessage[];
  signal: AbortSignal;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}) {
  const openrouter = createOpenRouter({ apiKey, fetch });
  const result = streamText({
    model: openrouter(model),
    instructions: INSTRUCTIONS,
    messages: toModelMessages(messages),
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(55_000)]),
    maxOutputTokens: 4096,
    maxRetries: 1,
  });
  return createUIMessageStreamResponse({
    headers: { "Cache-Control": "no-store" },
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: false,
      messageMetadata: ({ part }) =>
        part.type === "start"
          ? { modelId: model, demo: false, createdAt: Date.now() }
          : undefined,
      onError: modelErrorMessage,
    }),
  });
}
