import { assetReadUrl, getAsset, readAssetBytes } from "@/lib/server/media-store";
import { mediaSession } from "@/lib/server/media-session";
import { assertMediaEnabled, mediaError } from "@/lib/server/media-http";
import { RequestError } from "@/lib/server/request";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMediaEnabled();
    const asset = await getAsset(mediaSession(request).owner, (await params).id);
    if (asset.status !== "ready") throw new RequestError("This image is not ready yet.", 404);
    const download = new URL(request.url).searchParams.has("download");
    const signedUrl = await assetReadUrl(asset, download);
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (signedUrl) return new Response(null, { status: 307, headers: { ...headers, Location: signedUrl } });
    return new Response(new Uint8Array(await readAssetBytes(asset)), { headers: {
      ...headers, "Content-Type": asset.mediaType,
      ...(download ? { "Content-Disposition": `attachment; filename="numbase-${asset.id}.${asset.mediaType.split("/")[1]}"` } : {}),
    } });
  } catch (error) { return mediaError(error); }
}
