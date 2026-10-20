import { requestSchema } from "../chat-schema.ts";
import { demoResponse } from "./demo.ts";
import {
  readChatBody,
  RequestError,
  takeRequestSlot,
} from "./request.ts";
import { streamOpenRouterResponse } from "./openrouter-chat.ts";
import { imageIds } from "../chat-history.ts";
import { mediaSession } from "./media-session.ts";
import { multimodalHistory } from "./multimodal-history.ts";
import { findModel, imageLimit, supportsImages } from "../models.ts";
import { liveRequestsEnabled, mediaAvailable, requireMedia } from "./media-config.ts";
export async function handleChat(request: Request, fetch?: typeof globalThis.fetch) {
  try {
    const parsed = requestSchema.safeParse(await readChatBody(request));
    if (!parsed.success)
      throw new RequestError(
        "Check your message and selected model. Long conversations may need a new chat.",
        400,
      );
    if (!takeRequestSlot())
      return new Response("Too many requests. Please wait a minute.", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    const { model, messages, id } = parsed.data;
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) return demoResponse(model, request.signal);
    if (!liveRequestsEnabled())
      throw new RequestError(
        "Live chat is not enabled on this deployment yet.",
        503,
      );
    const ids = imageIds(messages);
    if (!id && ids.length) throw new RequestError("A conversation ID is required for images.", 400);
    const limit = imageLimit(model);
    if (limit !== undefined && ids.length > limit)
      throw new RequestError(
        `${findModel(model)!.name} supports up to ${limit} images per request. This chat contains ${ids.length}. Choose another vision model to keep all image context. Your history is still saved.`,
        400,
      );
    // Never discard image history silently when media configuration is unavailable.
    if (ids.length) requireMedia();
    const session = id && mediaAvailable() ? mediaSession(request, true) : undefined;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(session ? 165_000 : 55_000)]);
    const modelMessages = session && id ? await multimodalHistory(messages, session.owner, id, supportsImages(model), signal) : undefined;
    const response = streamOpenRouterResponse({
      model,
      messages,
      signal,
      apiKey,
      fetch,
      modelMessages,
      imageContext: session && id ? { owner: session.owner, conversationId: id, turnId: messages.at(-1)!.id, allowedIds: ids, selectedIds: imageIds([messages.at(-1)!]) } : undefined,
    });
    if (session?.cookie) response.headers.set("Set-Cookie", session.cookie);
    return response;
  } catch (error) {
    return new Response(
      error instanceof RequestError
        ? error.message
        : "Chat is temporarily unavailable. Please try again.",
      {
        status: error instanceof RequestError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
