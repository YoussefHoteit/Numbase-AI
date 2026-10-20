import { z } from "zod";
import { getAsset, getJob, jobId } from "@/lib/server/media-store";
import { resultOf } from "@/lib/server/image-tools";
import { mediaSession } from "@/lib/server/media-session";
import { assertMediaEnabled, mediaError } from "@/lib/server/media-http";
import { readChatBody, RequestError } from "@/lib/server/request";
const schema = z.object({ conversationId: z.string().min(1).max(128), turnId: z.string().min(1).max(128) }).strict();
export async function POST(request: Request) {
  try {
    assertMediaEnabled();
    const parsed = schema.safeParse(await readChatBody(request));
    if (!parsed.success) throw new RequestError("Choose a valid image request.", 400);
    const { owner } = mediaSession(request);
    const { conversationId, turnId } = parsed.data;
    const job = await getJob(owner, jobId(owner, conversationId, turnId));
    const image = job?.status === "succeeded" && job.assetId ? resultOf(await getAsset(owner, job.assetId, conversationId)) : undefined;
    return Response.json({ status: job?.status ?? "not-started", ...(image ? { image } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mediaError(error); }
}
