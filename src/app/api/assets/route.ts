import { z } from "zod";
import { MAX_IMAGE_BYTES, assetUrl, imageTypeSchema } from "@/lib/media";
import { newUpload, storageMode } from "@/lib/server/media-store";
import { mediaSession } from "@/lib/server/media-session";
import { assertMediaEnabled, mediaError } from "@/lib/server/media-http";
import { readChatBody, RequestError, takeRequestSlot } from "@/lib/server/request";
const schema = z.object({ conversationId: z.string().min(1).max(128), filename: z.string().min(1).max(160), mediaType: imageTypeSchema, size: z.number().int().min(1).max(MAX_IMAGE_BYTES) }).strict();
export async function POST(request: Request) {
  try {
    assertMediaEnabled();
    const parsed = schema.safeParse(await readChatBody(request));
    if (!parsed.success) throw new RequestError("Choose a JPEG, PNG, or WebP image up to 5 MB.", 400);
    if (storageMode() === "unavailable") throw new RequestError("Image storage is not configured yet.", 503);
    if (!takeRequestSlot()) throw new RequestError("Too many uploads. Please wait a minute.", 429);
    const { owner } = mediaSession(request);
    const data = parsed.data;
    const { asset, uploadUrl } = await newUpload(owner, data.conversationId, data.filename, data.mediaType, data.size);
    return Response.json({ assetId: asset.id, url: assetUrl(asset.id), uploadUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mediaError(error); }
}
