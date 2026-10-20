import { assetUrl } from "@/lib/media";
import { finishUpload } from "@/lib/server/media-store";
import { mediaSession } from "@/lib/server/media-session";
import { assertMediaEnabled, mediaError } from "@/lib/server/media-http";
import { readChatBody } from "@/lib/server/request";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMediaEnabled(); await readChatBody(request);
    const asset = await finishUpload(mediaSession(request).owner, (await params).id);
    return Response.json({ assetId: asset.id, url: assetUrl(asset.id), filename: asset.filename, mediaType: asset.mediaType, width: asset.width, height: asset.height }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mediaError(error); }
}
