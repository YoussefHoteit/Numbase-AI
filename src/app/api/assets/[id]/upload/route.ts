import { MAX_IMAGE_BYTES } from "@/lib/media";
import { getAsset, storageMode, writeAssetBytes } from "@/lib/server/media-store";
import { mediaSession } from "@/lib/server/media-session";
import { assertMediaEnabled, mediaError } from "@/lib/server/media-http";
import { assertSameOrigin, readBoundedBody, RequestError } from "@/lib/server/request";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMediaEnabled(); assertSameOrigin(request);
    if (storageMode() !== "local") throw new RequestError("Upload directly to the signed storage URL.", 400);
    const asset = await getAsset(mediaSession(request).owner, (await params).id);
    if (asset.status !== "pending") throw new RequestError("This upload is already complete.", 409);
    const bytes = await readBoundedBody(request, MAX_IMAGE_BYTES);
    if (bytes.length !== asset.size) throw new RequestError("The image size does not match.", 400);
    await writeAssetBytes(asset, bytes);
    return Response.json({ uploaded: true });
  } catch (error) { return mediaError(error); }
}
