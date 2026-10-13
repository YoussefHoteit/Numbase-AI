import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createUIMessageStreamResponse, streamText, toUIMessageStream } from "ai";
import { requestSchema } from "@/lib/chat-schema";
import { demoResponse } from "@/lib/server/demo";
import { readChatBody, RequestError, takeRequestSlot } from "@/lib/server/request";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await readChatBody(request));
    if (!parsed.success) throw new RequestError("Check your message and selected model. Long conversations may need a new chat.", 400);
    if (!takeRequestSlot()) return new Response("Too many requests. Please wait a minute.", { status: 429, headers: { "Retry-After": "60" } });
    const { model, messages } = parsed.data;
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) return demoResponse(model, request.signal);
    if (process.env.NODE_ENV === "production" && process.env.NUMBASE_DEPLOYMENT_PROTECTED !== "true")
      throw new RequestError("Live chat is not enabled on this deployment yet.", 503);
    const openrouter = createOpenRouter({ apiKey });
    const result = streamText({
      model: openrouter(model), instructions: "You are Numbase AI, a thoughtful, helpful assistant. Use clear Markdown when useful. Be honest about uncertainty.",
      messages: messages.map((message) => ({ role: message.role, content: message.parts.map((part) => part.text).join("\n") })),
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]), maxOutputTokens: 4096, maxRetries: 1,
    });
    return createUIMessageStreamResponse({ headers: { "Cache-Control": "no-store" }, stream: toUIMessageStream({
      stream: result.stream, sendReasoning: false,
      messageMetadata: ({ part }) => part.type === "start" ? { modelId: model, demo: false, createdAt: Date.now() } : undefined,
      onError: () => "The model could not respond. Please retry or choose another model.",
    }) });
  } catch (error) {
    return new Response(error instanceof RequestError ? error.message : "Chat is temporarily unavailable. Please try again.",
      { status: error instanceof RequestError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
