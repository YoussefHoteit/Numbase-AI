import { requestSchema } from "@/lib/chat-schema";
import { demoResponse } from "@/lib/server/demo";
import {
  readChatBody,
  RequestError,
  takeRequestSlot,
} from "@/lib/server/request";
import { streamOpenRouterResponse } from "@/lib/server/openrouter-chat";
export const maxDuration = 60;
export async function POST(request: Request) {
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
    const { model, messages } = parsed.data;
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) return demoResponse(model, request.signal);
    // This flag acknowledges the separate Vercel Authentication setup; it is not auth itself.
    if (
      process.env.NODE_ENV === "production" &&
      process.env.NUMBASE_DEPLOYMENT_PROTECTED !== "true"
    )
      throw new RequestError(
        "Live chat is not enabled on this deployment yet.",
        503,
      );
    return streamOpenRouterResponse({
      model,
      messages,
      signal: request.signal,
      apiKey,
    });
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
