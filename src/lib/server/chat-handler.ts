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
import { documentIds } from "../documents.ts";
import { requireDocuments, filesAvailable } from "./document-config.ts";
import { generatedFileIds } from "../generated-files.ts";
import { getDocument } from "./document-store.ts";
import { messageContextSize } from "../extractions.ts";
import { retrieveDocuments, addDocumentContext, waitForReadyDocuments } from "./document-retrieval.ts";
import { toModelMessages } from "../chat-history.ts";
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
    const files = documentIds(messages);
    const generated = generatedFileIds(messages);
    if (!id && (ids.length || files.length || generated.length)) throw new RequestError("A conversation ID is required for attachments.", 400);
    const limit = imageLimit(model);
    if (limit !== undefined && ids.length > limit)
      throw new RequestError(
        `${findModel(model)!.name} supports up to ${limit} images per request. This chat contains ${ids.length}. Choose another vision model to keep all image context. Your history is still saved.`,
        400,
      );
    // Never discard image history silently when media configuration is unavailable.
    if (ids.length) requireMedia();
    if (files.length || generated.length) requireDocuments();
    const session = id && (mediaAvailable() || files.length || generated.length || filesAvailable()) ? mediaSession(request, true) : undefined;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(session ? 165_000 : 55_000)]);
    let modelMessages = session && id ? await multimodalHistory(messages, session.owner, id, supportsImages(model), signal) : undefined;
    if (session && id && files.length) {
      await waitForReadyDocuments(session.owner, id, files, signal);
      const recentQuestions = messages.filter((message) => message.role === "user").slice(-3).flatMap((message) => message.parts.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");
      const matches = await retrieveDocuments(session.owner, id, files, recentQuestions || "Describe the attached files", signal);
      modelMessages = addDocumentContext(modelMessages ?? toModelMessages(messages), matches);
    }
    const fileIds = [...new Set([...files, ...generated])];
    const fileContext = session && id && filesAvailable() ? {
      owner: session.owner, conversationId: id, turnId: messages.at(-1)!.id, allowedIds: fileIds,
      sources: await Promise.all(fileIds.map(async (fileId) => {
        const doc = await getDocument(session.owner, fileId, id);
        return { id: doc.id, filename: doc.filename, version: doc.generated?.version ?? 0 };
      })),
      remainingCharacters: Math.max(0, 52_000 - messages.reduce((size, message) => size + messageContextSize(message), 0)),
      remainingBytes: Math.max(0, 96_000 - new TextEncoder().encode(JSON.stringify(messages)).length),
    } : undefined;
    const response = streamOpenRouterResponse({
      model,
      messages,
      signal,
      apiKey,
      fetch,
      modelMessages,
      fileContext,
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
